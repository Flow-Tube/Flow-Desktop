import { useEffect } from "react";

import { isTauriEnv } from "../api/env";
import { publishNow, type Now } from "../api/live";
import { IS_MAIN_WINDOW } from "../appWindow";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { changed, nowOf } from "./now";
import { playing } from "./players";

/** While playing, `now` goes out at least this often, so other devices keep the position right. */
const REPEAT_MS = 30_000;

/**
 * Tells the group's other devices what this one plays (spec/live.md, Playing on another device):
 * on every change, and every 30 seconds while playing. Nothing goes out outside a group.
 */
export function useLiveNow(): void {
  useEffect(() => {
    const stops: Array<() => void> = [];
    let ended = false;
    void isTauriEnv().then((tauri) => {
      if (!tauri || !IS_MAIN_WINDOW || ended) return;
      let sent: Now | null = null;
      let sentAtMs = 0;
      const publish = (repeat: boolean) => {
        const next = nowOf(playing());
        const at = Date.now();
        if ((sent?.video ?? null) === null && next.video === null) return;
        if (!repeat && !changed(sent, sentAtMs, next, at)) return;
        sent = next;
        sentAtMs = at;
        publishNow(next).catch(() => undefined);
      };
      stops.push(usePlayerStore.subscribe(() => publish(false)), useMusicPlayerStore.subscribe(() => publish(false)));
      const timer = setInterval(() => sent?.state === "playing" && publish(true), REPEAT_MS);
      stops.push(() => clearInterval(timer));
    });
    return () => {
      ended = true;
      stops.forEach((stop) => stop());
    };
  }, []);
}
