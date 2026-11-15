import { useEffect, useState } from "react";

import { getLeftOut, setLeftOut, type SyncChoice } from "../api/linked";
import type { StringKey } from "../i18n/index";

/** Every choice, in the order the page lists them, with its name. */
export const SYNC_CHOICES: ReadonlyArray<[SyncChoice, StringKey]> = [
  ["watchHistory", "linked_choice_watch_history"],
  ["playlists", "linked_choice_playlists"],
  ["likes", "linked_choice_likes"],
  ["subscriptions", "linked_choice_subscriptions"],
  ["notes", "linked_choice_notes"],
  ["recommendations", "linked_choice_recommendations"],
  ["settings", "linked_choice_settings"],
];

/** `leftOut` with `choice` synced or left out, in the page's order. */
export function withChoice(leftOut: readonly SyncChoice[], choice: SyncChoice, syncs: boolean): SyncChoice[] {
  const next = new Set(leftOut);
  if (syncs) next.delete(choice);
  else next.add(choice);
  return SYNC_CHOICES.map(([key]) => key).filter((key) => next.has(key));
}

/**
 * What this device leaves out of its links, and a way to change it. A change shows at once and
 * goes back if the backend refuses it, which `onFailed` is told about.
 */
export function useSyncChoices(onFailed: () => void) {
  const [leftOut, setShown] = useState<SyncChoice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeftOut().then(
      (choices) => {
        if (!cancelled) setShown(choices);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (choice: SyncChoice, syncs: boolean) => {
    if (!leftOut) return;
    const before = leftOut;
    const next = withChoice(before, choice, syncs);
    setShown(next);
    setLeftOut(next).catch(() => {
      setShown(before);
      onFailed();
    });
  };

  return { leftOut, choose };
}
