import { useEffect, useMemo, useState } from "react";

import {
  getDownloadFormats,
  startDownload,
  type CaptionOption,
  type DownloadAudioOption,
  type DownloadableFormat,
  type DownloadStarted,
} from "./api/downloads";
import { getBackendErrorMessage } from "./api/errors";
import {
  defaultSubtitle,
  musicDownloadRequest,
  preferredDownloadHeight,
  videoDownloadRequest,
  videoSelectionFor,
} from "./downloadActions";
import {
  defaultRow,
  preferredCodec,
  qualityRows,
  resolutionBadge,
  type CodecChoice,
} from "./downloadOptions";
import { IS_MACOS_RUNTIME } from "./platform";
import { noteVideoSaved } from "./videoSaved";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { SongItem } from "../types/music";
import type { VideoSummary } from "../types/video";

export type VideoDownloadMode = "video" | "audio";

/** A short description of a format for the dock: "1080p · VP9 · 60 fps". */
export function describeFormat(format: DownloadableFormat): string {
  const fps = format.fps && format.fps > 30 ? ` · ${format.fps} fps` : "";
  return `${format.height ? `${format.height}p` : format.resolution} · ${format.videoCodec}${fps}`;
}

export { resolutionBadge };

/** A video's audio saved on its own: kept as an AAC song tagged with the video. */
function audioOnlySong(video: VideoSummary): SongItem {
  return {
    id: video.id,
    title: video.title,
    artists: video.channelName ? [{ name: video.channelName, id: video.channelId ?? null }] : [],
    album: null,
    duration: video.durationSeconds ?? null,
    musicVideoType: null,
    thumbnail: video.thumbnailUrl ?? "",
    explicit: false,
    videoId: video.id,
    playlistId: null,
    params: null,
  };
}

export function useVideoDownloadDialog(video: VideoSummary | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [formats, setFormats] = useState<DownloadableFormat[]>([]);
  const [audioTracks, setAudioTracks] = useState<DownloadAudioOption[]>([]);
  const [captions, setCaptions] = useState<CaptionOption[]>([]);
  const [mode, setMode] = useState<VideoDownloadMode>("video");
  const [codec, setCodec] = useState<CodecChoice>("Auto");
  const [selectedId, setSelectedId] = useState("");
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const preferred = preferredCodec(values, IS_MACOS_RUNTIME);

  useEffect(() => {
    setFormats([]);
    setAudioTracks([]);
    setCaptions([]);
    setMode("video");
    setCodec("Auto");
    setSelectedId("");
    setAudioKey(null);
    setTitle(video?.title ?? "");
    setFolder(null);
    setError(null);
    if (!video) return;
    let cancelled = false;
    setLoading(true);
    void getDownloadFormats(video.id)
      .then((options) => {
        if (cancelled) return;
        setFormats(options.formats);
        setAudioTracks(options.audioTracks);
        setCaptions(options.captions);
        setAudioKey(options.audioTracks.find((track) => track.isDefault)?.key ?? options.audioTracks[0]?.key ?? null);
        const wanted = defaultSubtitle(useAppSettingsStore.getState().values)?.languageCode ?? "";
        setSubtitle(options.captions.some((caption) => caption.languageCode === wanted) ? wanted : "");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [video, attempt]);

  const rows = useMemo(() => qualityRows(formats, codec, preferred), [formats, codec, preferred]);
  const availableCodecs = useMemo(
    () => new Set(formats.map((format) => format.videoCodec)),
    [formats],
  );

  // Keep a selection that still exists in the visible rows; otherwise fall back
  // to the default quality.
  useEffect(() => {
    if (rows.some((row) => row.formatId === selectedId)) return;
    setSelectedId(defaultRow(rows, preferredDownloadHeight(values))?.formatId ?? "");
  }, [rows, selectedId, values]);

  const selected = rows.find((row) => row.formatId === selectedId) ?? null;
  const audioTrack = audioTracks.find((track) => track.key === audioKey) ?? null;
  const originalAudio = audioTracks.find((track) => track.isDefault) ?? audioTracks[0] ?? null;
  const audioSize = mode === "audio" ? originalAudio?.sizeBytes ?? null : null;
  const totalSize = mode === "audio"
    ? audioSize
    : selected?.estimatedSizeBytes ?? null;

  const submit = async (): Promise<DownloadStarted | null> => {
    if (!video) return null;
    setStarting(true);
    setError(null);
    try {
      const overrides = {
        title,
        destinationDirectory: folder ?? undefined,
      };
      let started: DownloadStarted;
      if (mode === "audio") {
        started = await startDownload({
          ...musicDownloadRequest(audioOnlySong(video), values, "AAC", overrides),
          mediaKind: "audio",
          tags: { channelName: video.channelName || undefined, channelId: video.channelId ?? undefined },
        });
      } else {
        if (!selected) return null;
        const selection = {
          ...videoSelectionFor(selected),
          audioTrack: audioTrack && !audioTrack.isDefault ? audioTrack.key : undefined,
        };
        const caption = captions.find((option) => option.languageCode === subtitle);
        started = await startDownload(
          videoDownloadRequest(video, values, selection, describeFormat(selected), {
            ...overrides,
            subtitle: caption
              ? { languageCode: caption.languageCode, autoGenerated: caption.isAutoGenerated }
              : undefined,
          }),
        );
      }
      noteVideoSaved(video);
      return started;
    } catch (reason) {
      setError(reason);
      return null;
    } finally {
      setStarting(false);
    }
  };

  return {
    audioKey,
    audioTrack,
    audioTracks,
    availableCodecs,
    captions,
    codec,
    error,
    errorMessage: error ? getBackendErrorMessage(error) : null,
    folder,
    loading,
    mode,
    originalAudio,
    preferredCodec: preferred,
    retry: () => setAttempt((value) => value + 1),
    rows,
    selected,
    selectedId,
    setAudioKey,
    setCodec,
    setFolder,
    setMode,
    setSelectedId,
    setSubtitle,
    setTitle,
    starting,
    submit,
    subtitle,
    title,
    totalSize,
  };
}
