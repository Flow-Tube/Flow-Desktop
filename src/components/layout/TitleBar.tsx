import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { usePageTitleStore } from "../../store/usePageTitleStore";
import { WindowResizeEdges } from "../ui/WindowResizeEdges";

const appWindow = getCurrentWindow();

// Static section labels keyed by exact pathname. Rendered as spaced-out uppercase
// "section" chrome; dynamic content titles (video/song/channel/search/…) render in
// natural case for readability.
const STATIC_TITLES: Record<string, string> = {
  "/": "Home",
  "/feed": "FlowNeuro",
  "/music": "Music",
  "/explore": "Explore",
  "/subscriptions": "Subscriptions",
  "/playlists": "Playlists",
  "/watch-later": "Watch Later",
  "/library": "Library",
  "/albums": "Albums",
  "/saved-shorts": "Saved Shorts",
  "/history": "History",
  "/downloads": "Downloads",
  "/liked": "Liked",
  "/settings": "Settings",
  "/settings/import": "Import Data",
  "/sync": "Sync",
  "/support": "Support",
  "/sponsorblock": "Extensions",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type ResolvedTitle = { text: string; section: boolean };

function useResolvedTitle(): ResolvedTitle {
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
      return q ? { text: q, section: false } : { text: "Search", section: true };
    }

    // Channel / artist / album / playlist titles are published by their pages.
    if (override) return { text: override, section: false };

    // Static section labels.
    const label = STATIC_TITLES[pathname];
    if (label) return { text: label, section: true };
    if (pathname.startsWith("/shorts")) return { text: "Shorts", section: true };

    // Dynamic routes before their page has published a title yet — stay blank.
    return { text: "", section: false };
  }, [pathname, search, musicOverlayOpen, trackTitle, currentVideoId, currentVideoTitle, override]);
}

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const { text, section } = useResolvedTitle();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        setIsMaximized(await appWindow.isMaximized());
        unlisten = await appWindow.onResized(async () => {
          setIsMaximized(await appWindow.isMaximized());
        });
      } catch {
      }
    };
    void setup();
    return () => unlisten?.();
  }, []);

  const controlBtn =
    "grid h-full w-[46px] place-items-center text-on-surface-variant transition-colors";

  return (
    <>
      <div className="relative z-[100] flex h-8 shrink-0 select-none items-center border-b border-outline-variant/60 bg-background">
        <div data-tauri-drag-region className="absolute inset-0" />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-40">
          {text && (
            <span
              className={cx(
                "max-w-full truncate text-center text-xs",
                section
                  ? "font-semibold uppercase tracking-[0.14em] text-on-surface-variant"
                  : "font-medium tracking-wide text-on-surface"
              )}
            >
              {text}
            </span>
          )}
        </div>

        {/* Window controls */}
        <div className="relative z-10 ml-auto flex h-full items-center">
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => void appWindow.minimize()}
            className={`${controlBtn} hover:bg-on-surface/10 hover:text-on-surface`}
          >
            <Minus size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            onClick={() => void appWindow.toggleMaximize()}
            className={`${controlBtn} hover:bg-on-surface/10 hover:text-on-surface`}
          >
            {isMaximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => void appWindow.close()}
            className={`${controlBtn} hover:bg-primary hover:text-chrome-white`}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <WindowResizeEdges />
    </>
  );
}
