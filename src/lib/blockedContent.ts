import { create } from "zustand";

import { SETTINGS } from "./settings/schema";
import { getSettingValue, setSettingValue } from "../store/useAppSettingsStore";

interface RevealState {
  revealedVideoIds: Set<string>;
  reveal: (videoId: string) => void;
  hideAll: () => void;
}

/**
 * Reveals last for the session only: a blocked video that stayed revealed
 * across restarts would quietly undo the block list it was matched against.
 */
export const useBlockedRevealStore = create<RevealState>((set, get) => ({
  revealedVideoIds: new Set(),
  reveal: (videoId) => {
    if (!videoId || get().revealedVideoIds.has(videoId)) return;
    set({ revealedVideoIds: new Set(get().revealedVideoIds).add(videoId) });
  },
  hideAll: () => set({ revealedVideoIds: new Set() }),
}));

async function hashPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hasRevealPin(): boolean {
  return getSettingValue(SETTINGS.BLOCKED_REVEAL_PIN).length > 0;
}

export async function setRevealPin(pin: string): Promise<boolean> {
  const trimmed = pin.trim();
  return setSettingValue(SETTINGS.BLOCKED_REVEAL_PIN, trimmed ? await hashPin(trimmed) : "");
}

export async function verifyRevealPin(pin: string): Promise<boolean> {
  const stored = getSettingValue(SETTINGS.BLOCKED_REVEAL_PIN);
  if (!stored) return true;
  return stored === (await hashPin(pin.trim()));
}
