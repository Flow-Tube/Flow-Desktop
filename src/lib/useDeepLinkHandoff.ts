import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { listen } from "@tauri-apps/api/event";

import { getVideoDetails } from "./api/youtube";
import { getMusicQueue } from "./api/music";
import { addWatchRecord } from "./api/db";
import { shouldRecordWatchHistory } from "./deepFlow";
import { seekToTime } from "./linkify";
import { prefetchStreamInfo } from "./streamResolution";
import { getString } from "./i18n/index";
import { useDownloadStore } from "../store/useDownloadStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem } from "../types/music";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

type Handoff =
  | { action: "watch"; v: string; t?: number; list?: string }
  | { action: "music"; v: string }
  | { action: "download"; v: string }
  | { action: "music-download"; v: string };

// Both transports deliver the same `flow://action?…` string: the deep-link
// plugin (app launched or already running) and the loopback bridge (silent
// handoff from the extension, re-emitted on the `handoff://url` event).
function parseFlowUrl(raw: string): Handoff | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "flow:") return null;

  // flow://watch → host "watch"; tolerate flow:///watch → path "/watch".
  const action = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  const v = url.searchParams.get("v") ?? "";
  if (!VIDEO_ID.test(v)) return null;

  if (action === "download") return { action: "download", v };
  if (action === "music-download") return { action: "music-download", v };
  if (action === "music") return { action: "music", v };
  if (action === "watch") {
    const rawT = url.searchParams.get("t");
    const t = rawT && /^\d{1,9}$/.test(rawT) ? Number(rawT) : undefined;
    const list = url.searchParams.get("list");
    return { action: "watch", v, t, list: list && PLAYLIST_ID.test(list) ? list : undefined };
  }
  return null;
}

// The music player and music download dialog both need a full SongItem, not a
// bare id. A single-video music queue resolves the track's metadata (title,
// artists, thumbnail) the same way the in-app surfaces do.
async function resolveSong(videoId: string): Promise<SongItem | null> {
  try {
    const queue = await getMusicQueue([videoId]);
    const match = queue.items.find((track) => (track.videoId ?? track.id) === videoId);
    return match ?? queue.items[0] ?? null;
  } catch {
    return null;
  }
}

// The video element only accepts a seek once it knows its duration. Poll briefly
// after navigation, then hand off to the player's existing seek event bus.
function applyStartOffset(seconds: number) {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      seekToTime(seconds);
      return;
    }
    if (attempts < 20) window.setTimeout(tick, 300);
  };
  window.setTimeout(tick, 400);
}

/**
 * Subscribes to `flow://` deep links and bridge handoffs and routes them:
 * `watch`/`music` → the Watch page (which resolves the video from its id),
 * `download` → the global download dialog. Mounted once at the App root.
 */
export function useDeepLinkHandoff() {
  const navigate = useNavigate();
  const location = useLocation();

  const pendingRef = useRef<Handoff | null>(null);
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const route = useCallback(
    async (handoff: Handoff) => {
      if (handoff.action === "download") {
        try {
          const details = await getVideoDetails(handoff.v);
          // The dialog is a global overlay — it opens over the current page.
          // flush() already ensures we're past onboarding before we get here.
          useDownloadStore.getState().openVideo({
            id: details.id,
            title: details.title,
            channelName: details.channelName,
            channelId: details.channelId,
            thumbnailUrl: details.thumbnailUrl,
            durationSeconds: details.durationSeconds,
          });
        } catch {
          useUiStore.getState().showToast({
            variant: "error",
            message: getString("handoff_video_unavailable"),
          });
        }
        return;
      }

      // Music handoffs play in the global dock / open the music download dialog
      // rather than the video player — they never navigate away from the page.
      if (handoff.action === "music" || handoff.action === "music-download") {
        const song = await resolveSong(handoff.v);
        if (!song) {
          useUiStore.getState().showToast({
            variant: "error",
            message: getString("handoff_video_unavailable"),
          });
          return;
        }
        if (handoff.action === "music-download") {
          useDownloadStore.getState().openMusic(song);
          return;
        }
        void useMusicPlayerStore.getState().playTrack(song);
        // Seed the history row immediately; GlobalMusicAudio upserts real
        // progress as the track plays, so a very short listen still lands here.
        if (shouldRecordWatchHistory()) {
          void addWatchRecord({
            videoId: song.videoId ?? song.id,
            title: song.title,
            channelName: song.artists.map((a) => a.name).filter(Boolean).join(", ") || null,
            watchDate: new Date().toISOString(),
            watchDurationSeconds: 0,
            totalDurationSeconds: Math.floor(song.duration ?? 0),
            isMusic: true,
          });
        }
        return;
      }

      // Watch: seed the player queue up front (as in-app playback does) so the
      // video player mounts and starts recording history right away, instead of
      // relying on the Watch page to resolve the id on its own.
      try {
        const details = await getVideoDetails(handoff.v);
        usePlayerStore.getState().setQueue(
          [
            {
              id: details.id,
              title: details.title,
              channelName: details.channelName,
              channelId: details.channelId,
              thumbnailUrl: details.thumbnailUrl,
              durationSeconds: details.durationSeconds,
            },
          ],
          0,
        );
        if (shouldRecordWatchHistory()) {
          void addWatchRecord({
            videoId: details.id,
            title: details.title,
            channelName: details.channelName,
            channelId: details.channelId ?? null,
            watchDate: new Date().toISOString(),
            watchDurationSeconds: 0,
            totalDurationSeconds: Math.floor(details.durationSeconds ?? 0),
            isMusic: false,
          });
        }
      } catch {
        // Fall back to id-only navigation; the Watch page resolves it and shows
        // its own error state if the video is unavailable.
      }

      prefetchStreamInfo(handoff.v);
      navigate(`/watch/${handoff.v}`);
      if (handoff.t && handoff.t > 0) applyStartOffset(handoff.t);
    },
    [navigate],
  );

  // Hold a handoff that arrives mid-onboarding until setup finishes, so the
  // App's onboarding redirect never swallows it.
  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || pathnameRef.current === "/onboarding") return;
    pendingRef.current = null;
    void route(pending);
  }, [route]);

  const acceptRef = useRef((raw: string) => {
    const handoff = parseFlowUrl(raw);
    if (!handoff) return;
    pendingRef.current = handoff;
    flush();
  });
  acceptRef.current = (raw: string) => {
    const handoff = parseFlowUrl(raw);
    if (!handoff) return;
    pendingRef.current = handoff;
    flush();
  };

  // Subscribe exactly once — re-subscribing would double-handle a cold-start URL.
  useEffect(() => {
    let unlistenOpen: (() => void) | undefined;
    let unlistenBridge: (() => void) | undefined;

    const latest = (urls: string[] | null) => (urls && urls.length ? urls[urls.length - 1] : undefined);

    // `getCurrent()` returns the URL that *launched* the app and keeps returning
    // it across in-app reloads (F5) since the Rust process stays alive. Consume
    // it once per webview session so refreshing a page doesn't replay the
    // original handoff — bouncing the user back into the player or re-opening the
    // download dialog. sessionStorage is cleared on a real relaunch, so the next
    // genuine cold start is still handled.
    const COLD_START_KEY = "flow_handoff_cold_start_done";
    if (!sessionStorage.getItem(COLD_START_KEY)) {
      sessionStorage.setItem(COLD_START_KEY, "1");
      void getCurrent()
        .then((urls) => {
          const url = latest(urls);
          if (url) acceptRef.current(url);
        })
        .catch(() => {});
    }
    void onOpenUrl((urls) => {
      const url = latest(urls);
      if (url) acceptRef.current(url);
    }).then((fn) => (unlistenOpen = fn));
    void listen<string>("handoff://url", (event) => {
      if (event.payload) acceptRef.current(event.payload);
    }).then((fn) => (unlistenBridge = fn));

    return () => {
      unlistenOpen?.();
      unlistenBridge?.();
    };
  }, []);

  // Replay a queued handoff once we leave the onboarding route.
  useEffect(() => {
    flush();
  }, [location.pathname, flush]);
}
