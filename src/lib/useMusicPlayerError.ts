import { useCallback, useMemo } from "react";

import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useUiStore } from "../store/useUiStore";
import { classifyPlayerError, type PlayerErrorInfo } from "./playerError";
import { copyPlayerReport } from "./playerDiagnostics";
import { openExternal } from "./openExternal";
import { youtubeMusicWatchUrl } from "./youtubeUrl";
import { getString } from "./i18n/index";

export interface MusicPlayerErrorActions {
  errorInfo: PlayerErrorInfo | null;
  onRetry: () => void;
  onCopyLogs: () => Promise<boolean>;
  onOpenInBrowser: () => void;
}

/**
 * Bridges the music player store's raw `streamError`/`streamErrorKind` into the
 * shared `PlayerErrorState` contract: a classified `PlayerErrorInfo` plus the
 * three actions (retry / copy logs / open in browser). Both the dock and the
 * full overlay consume this so their failure UI stays identical.
 */
export function useMusicPlayerError(): MusicPlayerErrorActions {
  const streamError = useMusicPlayerStore((s) => s.streamError);
  const streamErrorKind = useMusicPlayerStore((s) => s.streamErrorKind);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const retryCurrentTrack = useMusicPlayerStore((s) => s.retryCurrentTrack);
  const showToast = useUiStore((s) => s.showToast);

  const errorInfo = useMemo(
    () =>
      streamError
        ? classifyPlayerError({ message: streamError, kind: streamErrorKind ?? "unknown" })
        : null,
    [streamError, streamErrorKind],
  );

  const videoId = currentTrack ? currentTrack.videoId ?? currentTrack.id : null;
  const watchUrl = videoId ? youtubeMusicWatchUrl(videoId) : null;

  const onRetry = useCallback(() => {
    retryCurrentTrack();
  }, [retryCurrentTrack]);

  const onCopyLogs = useCallback(async () => {
    if (!errorInfo) return false;
    const copied = await copyPlayerReport({
      surface: "music",
      error: errorInfo,
      videoId,
      title: currentTrack?.title ?? null,
      watchUrl,
    });
    if (!copied) {
      showToast({ variant: "error", message: getString("player_error_logs_copy_failed") });
    }
    return copied;
  }, [errorInfo, videoId, currentTrack, watchUrl, showToast]);

  const onOpenInBrowser = useCallback(() => {
    if (watchUrl) void openExternal(watchUrl);
  }, [watchUrl]);

  return { errorInfo, onRetry, onCopyLogs, onOpenInBrowser };
}
