import type { MiniBarButton } from "../../../lib/music/miniPlayerLook";
import type { PillTransportButton } from "./PillTransport";

const TRANSPORT = new Set<MiniBarButton>(["previous", "play_pause", "next"]);

export type PillSlot = { kind: "button"; button: MiniBarButton } | { kind: "transport"; buttons: PillTransportButton[] };

/**
 * The Pill's buttons in order, with Play/pause and a skip button chosen next to each other joined
 * into one split transport when `split` is on. A lone skip button stays a plain icon.
 */
export function pillSlots(buttons: readonly MiniBarButton[], split: boolean): PillSlot[] {
  const slots: PillSlot[] = [];
  let run: PillTransportButton[] = [];
  const flush = () => {
    if (run.length >= 2 && run.includes("play_pause")) slots.push({ kind: "transport", buttons: run });
    else for (const button of run) slots.push({ kind: "button", button });
    run = [];
  };
  for (const button of buttons) {
    if (split && TRANSPORT.has(button)) {
      run.push(button as PillTransportButton);
      continue;
    }
    flush();
    slots.push({ kind: "button", button });
  }
  flush();
  return slots;
}
