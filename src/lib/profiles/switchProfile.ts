import { emit, listen } from "@tauri-apps/api/event";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { cancelProfileSwitch, finishProfileSwitch, prepareProfileSwitch, type Profile } from "../api/profiles";
import { closePipWindow } from "../api/pip";
import { clearDiscordPresence } from "../api/discord";
import { CURRENT_WINDOW_LABEL } from "../appWindow";
import { profileStorage } from "../storage/profileStorage";
import { runBeforeProfileSwitch } from "./beforeSwitch";

export const PREPARE_SWITCH_EVENT = "profile://prepare-switch";
export const SWITCH_READY_EVENT = "profile://switch-ready";
/** Read by the next process's loading screen to keep showing "Switching to …". */
export const SWITCHING_TO_KEY = "flow_switching_to";

export interface PrepareSwitchPayload {
  token: string;
  from: string;
  target: Profile;
}

interface SwitchReadyPayload {
  token: string;
  label: string;
}

// Hidden BotGuard and n-sig webviews have other labels and hold nothing to save.
const APP_WINDOW = /^(main|flow-\d+)$/;
const WINDOW_WAIT_MS = 3000;
const PIP_HANDBACK_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function otherAppWindows(): Promise<string[]> {
  const windows = await getAllWebviewWindows();
  return windows.map((window) => window.label).filter((label) => APP_WINDOW.test(label) && label !== CURRENT_WINDOW_LABEL);
}

/** Every app window stops playback and saves what it would save on unload. */
async function saveEveryWindow(target: Profile): Promise<void> {
  const token = crypto.randomUUID();
  const waiting = new Set(await otherAppWindows());
  let resolveAll: () => void = () => {};
  const allReady = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });
  const unlisten = await listen<SwitchReadyPayload>(SWITCH_READY_EVENT, ({ payload }) => {
    if (payload.token !== token) return;
    waiting.delete(payload.label);
    if (waiting.size === 0) resolveAll();
  });
  try {
    if (waiting.size === 0) resolveAll();
    await emit(PREPARE_SWITCH_EVENT, { token, from: CURRENT_WINDOW_LABEL, target } satisfies PrepareSwitchPayload);
    // A window that doesn't answer in time is left to the process exit.
    await Promise.all([runBeforeProfileSwitch(), Promise.race([allReady, delay(WINDOW_WAIT_MS)])]);
  } finally {
    unlisten();
  }
}

/**
 * Switches profile by restarting Flow. Refusals (sync running, another switch) throw before
 * anything changes; a failure after that cancels the switch and throws.
 */
export async function switchProfile(target: Profile): Promise<void> {
  await prepareProfileSwitch(target.id);
  try {
    // Closing the pop-out hands its position back to the window it came from first.
    await closePipWindow().catch(() => undefined);
    await delay(PIP_HANDBACK_MS);
    await saveEveryWindow(target);
    void clearDiscordPresence();
    profileStorage.setItem(SWITCHING_TO_KEY, JSON.stringify(target), "device");
    await finishProfileSwitch(target.id);
  } catch (error) {
    profileStorage.removeItem(SWITCHING_TO_KEY, "device");
    await cancelProfileSwitch().catch(() => undefined);
    throw error;
  }
}

/** Every window but the one switching: save, then say so. */
export async function answerPrepareSwitch(payload: PrepareSwitchPayload): Promise<void> {
  if (payload.from === CURRENT_WINDOW_LABEL) return;
  await runBeforeProfileSwitch();
  await emit(SWITCH_READY_EVENT, { token: payload.token, label: CURRENT_WINDOW_LABEL } satisfies SwitchReadyPayload);
}
