import { useEffect, useMemo, useState } from "react";

import {
  getDownloadFormats,
  startDownload,
  type DownloadContainer,
  type DownloadableFormat,
} from "./api/downloads";
import {
  AUTO_DOWNLOAD_HEIGHT,
  musicDownloadQuality,
  musicDownloadRequest,
  videoDownloadRequest,
  videoSelectionFor,
} from "./downloadActions";
import { getBackendErrorMessage } from "./api/errors";
import { getMusicStream } from "./api/music";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { MusicStreamInfo, SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";
import { noteVideoSaved } from "./videoSaved";
import { saveLyricsWithDownload } from "./lyrics/downloadLyrics";


function codecLabel(mimeType?: string | null): string {
  const value = mimeType?.toLowerCase() ?? "";
  if (value.includes("opus")) return "Opus";
  if (value.includes("mp4a") || value.includes("aac")) return "AAC";
  return "Original";
}

export function selectDefaultFormat(
  formats: DownloadableFormat[],
  preferred: string,
): DownloadableFormat | null {
  if (formats.length === 0) return null;
  const parsed = Number.parseInt(preferred, 10);
  const preferredHeight = Number.isFinite(parsed) ? parsed : AUTO_DOWNLOAD_HEIGHT;
  const atOrBelow = formats.filter((format) => (format.height ?? 0) <= preferredHeight);
  if (atOrBelow.length > 0) {
    return atOrBelow.reduce((best, format) => ((format.height ?? 0) > (best.height ?? 0) ? format : best));
  }
  return [...formats].sort(
    (left, right) =>
      Math.abs((left.height ?? 0) - preferredHeight)
      - Math.abs((right.height ?? 0) - preferredHeight),
  )[0] ?? null;
}

export function displayDownloadResolution(format: DownloadableFormat): string {
  const height = format.height ?? Number.parseInt(format.resolution, 10);
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  return format.resolution || (height ? `${height}p` : "Auto");
}

export function describeDownloadFormat(format: DownloadableFormat): string {
  const frameRate = format.fps && format.fps > 30 ? ` · ${format.fps} FPS` : "";
  return `${displayDownloadResolution(format)} · ${format.videoCodec}${frameRate} · ${format.container.toUpperCase()}`;
}

export function describeMusicStream(stream: MusicStreamInfo): string {
  const bitrate = stream.bitrate ? `${Math.round(stream.bitrate / 1000)} kbps` : "Original quality";
  return `${codecLabel(stream.mimeType)} · ${bitrate}`;
}

export function useVideoDownloadDialog(video: VideoSummary | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [title, setTitle] = useState(video?.title ?? "");
  const [formats, setFormats] = useState<DownloadableFormat[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [startedId, setStartedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(video?.title ?? "");
    setFormats([]);
    setSelectedId("");
    setStartedId(null);
    setError(null);
    if (!video) return;

    let cancelled = false;
    setLoading(true);
    void getDownloadFormats(video.id)
      .then((resolved) => {
        if (cancelled) return;
        setFormats(resolved);
        const preferred = values[SETTINGS.DEFAULT_DOWNLOAD_QUALITY] ?? "720p";
        setSelectedId(selectDefaultFormat(resolved, preferred)?.formatId ?? "");
        if (resolved.length === 0) setError("download_no_adaptive_formats");
      })
      .catch((reason) => {
        if (!cancelled) setError(getBackendErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [video, values]);

  const selected = useMemo(
    () => formats.find((format) => format.formatId === selectedId) ?? formats[0] ?? null,
    [formats, selectedId],
  );
  const containers = useMemo(
    () => [...new Set(formats.map((format) => format.container))],
    [formats],
  );

  const selectContainer = (container: DownloadContainer) => {
    const candidates = formats.filter((format) => format.container === container);
    const preferred = selected?.height
      ? `${selected.height}p`
      : values[SETTINGS.DEFAULT_DOWNLOAD_QUALITY] ?? "720p";
    setSelectedId(selectDefaultFormat(candidates, preferred)?.formatId ?? "");
  };

  const submit = async () => {
    if (!video || !selected) return null;
    setStarting(true);
    setError(null);
    try {
      const started = await startDownload(
        videoDownloadRequest(video, values, videoSelectionFor(selected), describeDownloadFormat(selected), {
          title,
        }),
      );
      setStartedId(started.id);
      noteVideoSaved(video);
      return started;
    } catch (reason) {
      setError(getBackendErrorMessage(reason));
      return null;
    } finally {
      setStarting(false);
    }
  };

  return {
    containers,
    error,
    formats,
    loading,
    selected,
    selectedId,
    selectContainer,
    setSelectedId,
    setTitle,
    startedId,
    starting,
    submit,
    title,
  };
}

export function useMusicDownloadDialog(track: SongItem | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [title, setTitle] = useState(track?.title ?? "");
  const [stream, setStream] = useState<MusicStreamInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(track?.title ?? "");
    setStream(null);
    setError(null);
    if (!track) return;
    const id = track.videoId ?? track.id;
    let cancelled = false;
    setLoading(true);
    void getMusicStream(id, musicDownloadQuality(values), true)
      .then((resolved) => {
        if (!cancelled) setStream(resolved);
      })
      .catch((reason) => {
        if (!cancelled) setError(getBackendErrorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track, values]);

  const submit = async () => {
    if (!track || !stream) return null;
    setStarting(true);
    setError(null);
    try {
      const started = await startDownload({
        ...musicDownloadRequest(track, values, describeMusicStream(stream), { title }),
        loudnessDb: stream.loudnessDb ?? undefined,
      });
      saveLyricsWithDownload(track, started.id);
      return started;
    } catch (reason) {
      setError(getBackendErrorMessage(reason));
      return null;
    } finally {
      setStarting(false);
    }
  };

  return { error, loading, setTitle, starting, stream, submit, title };
}
