import { useMemo } from "react";

import { useBoolPref, useNumberPref } from "../usePreference";
import { SETTINGS } from "../settings/schema";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import {
  applyLocalFilters,
  continueWatching,
  groupByFolder,
  isHiddenByRules,
} from "./filters";

/** What the library page shows, from what the folders hold and what the viewer chose. */
export function useLocalMediaView() {
  const files = useLocalMediaStore((s) => s.files);
  const plays = useLocalMediaStore((s) => s.plays);
  const kind = useLocalMediaStore((s) => s.kind);
  const view = useLocalMediaStore((s) => s.view);
  const openFolderPath = useLocalMediaStore((s) => s.openFolder);
  const filters = useLocalMediaStore((s) => s.filters);
  const [hideRecordings] = useBoolPref(SETTINGS.LOCAL_MEDIA_HIDE_RECORDINGS);
  const [minAudioSeconds] = useNumberPref(SETTINGS.LOCAL_MEDIA_MIN_AUDIO_SECONDS);

  return useMemo(() => {
    const nowMs = Date.now();
    const ofKind = files.filter((file) => file.kind === kind);
    const shown = ofKind.filter((file) => !isHiddenByRules(file, { hideRecordings, minAudioSeconds }));
    const folders = groupByFolder(shown);
    const openFolder = folders.find((folder) => folder.path === openFolderPath) ?? null;
    return {
      nowMs,
      totalCount: shown.length,
      hiddenCount: ofKind.length - shown.length,
      folders,
      openFolder,
      items: applyLocalFilters(openFolder?.files ?? shown, filters, plays, nowMs),
      // Folder rows instead of files: the Folders view with no folder open and nothing searched.
      listsFolders: view === "folders" && !openFolder && !filters.query.trim(),
      continueWatching: kind === "video" && !openFolder ? continueWatching(shown, plays, nowMs) : [],
    };
  }, [files, plays, kind, view, openFolderPath, filters, hideRecordings, minAudioSeconds]);
}
