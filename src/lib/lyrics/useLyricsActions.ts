import { useCallback } from "react";

import type { SongItem } from "../../types/music";
import { useLyricsStore } from "../../store/useLyricsStore";
import { useUiStore } from "../../store/useUiStore";
import { copyText } from "../clipboard";
import { pickSaveFile } from "../dialogs";
import { writeLyricsFile } from "../api/files";
import { getString } from "../i18n/index";
import { lrcText } from "./lrcText";

const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/g;

/** The lyrics shown now, as LRC text when they are synced and as plain text otherwise. */
export function currentLyricsText(): string {
  const { entries, plain, isSynced } = useLyricsStore.getState();
  return lrcText(isSynced ? entries : [], plain ?? entries.map((e) => e.text).join("\n"));
}

/** Copy and save for the lyrics menu; the rest of its actions live on the lyrics store. */
export function useLyricsActions(track: SongItem | null) {
  const showToast = useUiStore((s) => s.showToast);

  const copy = useCallback(async () => {
    const { entries, plain } = useLyricsStore.getState();
    const text = plain ?? entries.map((e) => e.text).join("\n");
    if (!text.trim()) return;
    const copied = await copyText(text);
    showToast({ variant: copied ? "success" : "error", message: getString(copied ? "lyrics_copied" : "lyrics_copy_failed") });
  }, [showToast]);

  const save = useCallback(async () => {
    const text = currentLyricsText();
    if (!text.trim()) return;
    const artist = track?.artists.find((a) => a.name)?.name ?? "";
    const baseName = [artist, track?.title ?? ""].filter((part) => part.trim()).join(" - ").replace(UNSAFE_FILE_CHARS, "_");
    const path = await pickSaveFile(getString("lyrics_save_file"), `${baseName || "lyrics"}.lrc`, [
      { name: "LRC", extensions: ["lrc"] },
    ]);
    if (!path) return;
    try {
      await writeLyricsFile(path, text);
      showToast({ variant: "success", message: getString("lyrics_saved") });
    } catch {
      showToast({ variant: "error", message: getString("lyrics_save_failed") });
    }
  }, [track, showToast]);

  return { copy, save };
}
