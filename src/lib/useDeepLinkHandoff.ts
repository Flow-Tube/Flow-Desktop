import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { listen } from "@tauri-apps/api/event";
import { sessionStore } from "./storage/profileStorage";
import { holdLinkForNextProfile, takeHeldLink } from "./api/profiles";
import { takeLaunchLink } from "./api/tray";
import { useProfilesStore } from "../store/useProfilesStore";

import { getVideoDetails, resolveChannelId } from "./api/youtube";
import { getMusicQueue, getMusicWatchQueue } from "./api/music";
import { parseFlowUrl, type Handoff } from "./flowHandoff";
import { playLinkedPlaylist } from "./linkedPlaylist";
import { addWatchRecord } from "./api/db";
import { shouldRecordWatchHistory } from "./deepFlow";
import { seekWhenVideoReady } from "./playerSeek";
import { prefetchStreamInfo } from "./streamResolution";
import { getString } from "./i18n/index";
import { useDownloadStore } from "../store/useDownloadStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useUiStore } from "../store/useUiStore";
import type { SongItem } from "../types/music";

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

/** Plays a song from the playlist its link named. False when the list can't be read. */
async function playSongFromList(videoId: string, playlistId: string): Promise<boolean> {
  try {
    const { items } = await getMusicWatchQueue(videoId, playlistId);
    const index = items.findIndex((track) => (track.videoId ?? track.id) === videoId);
    if (index < 0) return false;
    await useMusicPlayerStore.getState().playQueue(items, index);
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to `flow://` deep links and bridge handoffs and routes them:
 * `watch` → the Watch page (which resolves the video from its id), `music` → the
 * music player, `download` → the global download dialog, and the rest of what a
 * link can name to its own page. Mounted once at the App root.
 */
export function useDeepLinkHandoff() {
  const navigate = useNavigate();
  const location = useLocation();

  const pendingRef = useRef<Handoff | null>(null);
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const route = useCallback(
    async (handoff: Handoff) => {
      if (handoff.action === "page") {
        navigate(handoff.route);
        return;
      }

      if (handoff.action === "channel") {
        try {
          const channelId = await resolveChannelId(handoff.url);
          navigate(handoff.music ? `/music/artist/${channelId}` : `/channel/${channelId}`);
        } catch {
          useUiStore.getState().showToast({ variant: "error", message: getString("handoff_link_unavailable") });
        }
        return;
      }

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
        const fromList = handoff.action === "music" && handoff.list ? await playSongFromList(handoff.v, handoff.list) : false;
        if (!fromList) void useMusicPlayerStore.getState().playTrack(song);
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

      if (handoff.list) void playLinkedPlaylist(handoff.list, handoff.v);
      prefetchStreamInfo(handoff.v);
      navigate(`/watch/${handoff.v}`);
      if (handoff.t && handoff.t > 0) seekWhenVideoReady(handoff.t);
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
    // During a profile switch the link belongs to the next profile, not this dying process.
    if (useProfilesStore.getState().switchingTo) {
      void holdLinkForNextProfile(raw).then((held) => {
        if (!held) acceptRef.current(raw);
      });
      return;
    }
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
    if (!sessionStore.getItem(COLD_START_KEY)) {
      sessionStore.setItem(COLD_START_KEY, "1");
      void getCurrent()
        .then((urls) => {
          const url = latest(urls);
          if (url) acceptRef.current(url);
        })
        .catch(() => {});
    }
    void takeHeldLink()
      .then((url) => {
        if (url) acceptRef.current(url);
      })
      .catch(() => {});
    void takeLaunchLink().then((url) => {
      if (url) acceptRef.current(url);
    });
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
