import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePageTitleStore } from "../store/usePageTitleStore";

// Static section labels keyed by exact pathname. Rendered as spaced-out uppercase
// "section" chrome; dynamic content titles (video/song/channel/search/…) render in
// natural case for readability.
const STATIC_TITLES: Record<string, string> = {
  "/": "home",
  "/feed": "flowNeuro",
  "/music": "music",
  "/explore": "explore",
  "/subscriptions": "subscriptions",
  "/playlists": "playlists",
  "/watch-later": "watchLater",
  "/library": "library",
  "/albums": "albums",
  "/saved-shorts": "savedShorts",
  "/history": "history",
  "/downloads": "downloads",
  "/liked": "liked",
  "/settings": "settings",
  "/settings/import": "importData",
  "/sync": "sync",
  "/support": "support",
  "/sponsorblock": "extensions",
};

type ResolvedTitle = { text: string; section: boolean };

export function useResolvedWindowTitle(): ResolvedTitle {
  const { t } = useTranslation();
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search;

  const currentVideoTitle = usePlayerStore((s) => s.currentVideo?.title ?? null);
  const currentVideoId = usePlayerStore((s) => s.currentVideo?.id ?? null);
  const trackTitle = useMusicPlayerStore((s) => s.currentTrack?.title ?? null);
  const musicOverlayOpen = useMusicPlayerStore(
    (s) => s.currentTrack !== null && s.viewState !== "dock"
  );
  const override = usePageTitleStore((s) => (s.path === pathname ? s.title : null));

  return useMemo<ResolvedTitle>(() => {
    // The full-screen music player renders above the titlebar → show the track.
    if (musicOverlayOpen && trackTitle) return { text: trackTitle, section: false };

    // Watch page → the video title, guarded so a background/PiP video doesn't leak.
    const watchMatch = pathname.match(/^\/watch\/([^/?#]+)/);
    if (watchMatch) {
      const routeId = decodeURIComponent(watchMatch[1] ?? "");
      if (currentVideoId === routeId && currentVideoTitle) {
        return { text: currentVideoTitle, section: false };
      }
      return { text: "", section: false };
    }

    // Search page → the query.
    if (pathname === "/search") {
      const q = new URLSearchParams(search).get("q")?.trim();
      return q ? { text: q, section: false } : { text: t("search"), section: true };
    }

    // Channel / artist / album / playlist titles are published by their pages.
    if (override) return { text: override, section: false };

    // Static section labels.
    const label = STATIC_TITLES[pathname];
    if (label) return { text: t(label), section: true };
    if (pathname.startsWith("/shorts")) return { text: t("shorts"), section: true };

    // Dynamic routes before their page has published a title yet — stay blank.
    return { text: "", section: false };
  }, [t, pathname, search, musicOverlayOpen, trackTitle, currentVideoId, currentVideoTitle, override]);
}

