import { useEffect, useMemo, useState } from "react";

import { startDownload, type DownloadStarted } from "./api/downloads";
import { getBackendErrorMessage } from "./api/errors";
import { getMusicStream, type MusicAudioQuality } from "./api/music";
import { musicDownloadQuality, musicDownloadRequest } from "./downloadActions";
import { audioSizeEstimate } from "./downloadOptions";
import { saveLyricsWithDownload } from "./lyrics/downloadLyrics";
import { getLyrics, lyricsRequestFor } from "./lyrics/lyricsHelper";
import { entriesAreSynced } from "./lyrics/sync";
import { SETTINGS } from "./settings/schema";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import type { SongItem } from "../types/music";

/** YouTube's small AAC stream (itag 139). */
const DATA_SAVER_KBPS = 48;

export type LyricsStatus = "looking" | "synced" | "plain" | "none";

export interface EditableTags {
  title: string;
  artist: string;
  album: string;
}

function initialTags(track: SongItem | null): EditableTags {
  return {
    title: track?.title ?? "",
    artist: track?.artists.map((artist) => artist.name).filter(Boolean).join(", ") ?? "",
    album: track?.album?.name ?? "",
  };
}

/** The song as it will be saved, with the user's edits. */
function editedTrack(track: SongItem, tags: EditableTags): SongItem {
  const artistNames = tags.artist
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const sameArtists = artistNames.join(", ") === track.artists.map((artist) => artist.name).join(", ");
  return {
    ...track,
    title: tags.title.trim() || track.title,
    artists: sameArtists ? track.artists : artistNames.map((name) => ({ name, id: null })),
    album: tags.album.trim()
      ? { name: tags.album.trim(), id: tags.album.trim() === track.album?.name ? track.album.id : "" }
      : null,
  };
}

export function useMusicDownloadDialog(track: SongItem | null) {
  const values = useAppSettingsStore((state) => state.values);
  const [quality, setQuality] = useState<MusicAudioQuality>(() => musicDownloadQuality(values));
  const [highKbps, setHighKbps] = useState<number | null>(null);
  const [tags, setTags] = useState<EditableTags>(() => initialTags(track));
  const [lyrics, setLyrics] = useState<LyricsStatus>("looking");
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setTags(initialTags(track));
    setQuality(musicDownloadQuality(useAppSettingsStore.getState().values));
    setHighKbps(null);
    setFolder(null);
    setError(null);
    setLyrics("looking");
    if (!track) return;
    let cancelled = false;
    setLoading(true);
    void getMusicStream(track.videoId ?? track.id, "High", true)
      .then((stream) => {
        if (!cancelled) setHighKbps(stream.bitrate ? Math.round(stream.bitrate / 1000) : null);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // The same lookup the download saves lyrics from, so this costs nothing extra.
    void getLyrics(lyricsRequestFor(track, track.duration ?? 0))
      .then((result) => {
        if (cancelled) return;
        if (!result || result.entries.length === 0) setLyrics("none");
        else setLyrics(entriesAreSynced(result.entries) ? "synced" : "plain");
      })
      .catch(() => {
        if (!cancelled) setLyrics("none");
      });
    return () => {
      cancelled = true;
    };
  }, [track]);

  const sizes = useMemo(
    () => ({
      High: audioSizeEstimate(track?.duration, highKbps ?? 128),
      Low: audioSizeEstimate(track?.duration, DATA_SAVER_KBPS),
    }),
    [track?.duration, highKbps],
  );

  const fileName = useMemo(() => {
    const title = tags.title.trim() || track?.title || "";
    const artist = tags.artist.split(",")[0]?.trim();
    return artist && !title.toLowerCase().includes(artist.toLowerCase()) ? `${artist} - ${title}` : title;
  }, [tags, track?.title]);

  const submit = async (): Promise<DownloadStarted | null> => {
    if (!track) return null;
    setStarting(true);
    setError(null);
    try {
      const song = editedTrack(track, tags);
      const kbps = quality === "Low" ? DATA_SAVER_KBPS : highKbps ?? 128;
      const started = await startDownload(
        musicDownloadRequest(
          song,
          { ...values, [SETTINGS.DOWNLOAD_MUSIC_QUALITY]: quality },
          `AAC · ${kbps} kbps`,
          { title: song.title, destinationDirectory: folder ?? undefined },
        ),
      );
      saveLyricsWithDownload(song, started.id);
      return started;
    } catch (reason) {
      setError(reason);
      return null;
    } finally {
      setStarting(false);
    }
  };

  return {
    error,
    errorMessage: error ? getBackendErrorMessage(error) : null,
    fileName,
    folder,
    highKbps,
    loading,
    lyrics,
    quality,
    setFolder,
    setQuality,
    setTags,
    sizes,
    starting,
    submit,
    tags,
  };
}
