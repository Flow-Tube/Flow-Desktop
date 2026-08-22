import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban,
  Bookmark,
  BookmarkCheck,
  Copy,
  Download,
  EyeOff,
  MoreVertical,
  Play,
  type LucideIcon,
} from "lucide-react";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { useUiStore } from "../../store/useUiStore";
import { SETTINGS } from "../../lib/settings/schema";
import { buildShortQueue, shortSummaryToItem } from "../../lib/shortsQueue";
import { prefetchStreamInfo } from "../../lib/streamResolution";
import {
  isShortSaved,
  removeShortFromLibrary,
  saveShortToLibrary,
} from "../../lib/savedShortsLibrary";
import { getString } from "../../lib/i18n/index";
import type { ShortVideoSummary, VideoSummary } from "../../types/video";

interface ShortCardProps {
  short: ShortVideoSummary;
  queue: ShortVideoSummary[];
  variant?: "shelf" | "grid";
}

export function ShortCard({ short, queue, variant = "grid" }: ShortCardProps) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const notInterestedAction = useFeedActionsStore((s) => s.notInterested);
  const blockChannelAction = useFeedActionsStore((s) => s.blockChannel);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const disableShortsPlayer = useAppSettingsStore(
    (state) => state.values[SETTINGS.DISABLE_SHORTS_PLAYER] === "true",
  );
  const title = short.title?.trim() || "Short";
  const video = useMemo<VideoSummary>(
    () => ({
      id: short.id,
      title,
      channelName: short.channelName ?? "",
      channelId: short.channelId ?? null,
      thumbnailUrl: short.thumbnailUrl ?? null,
      durationSeconds: 60,
      publishedText: short.publishedText ?? null,
      viewCountText: short.viewCountText ?? null,
      channelAvatarUrl: short.channelAvatarUrl ?? null,
      isLive: false,
    }),
    [short, title],
  );

  useEffect(() => {
    let active = true;
    isShortSaved(short.id)
      .then((saved) => {
        if (active) setSavedToLibrary(saved);
      })
      .catch((error) => console.warn("Failed to read saved Short state", error));

    return () => {
      active = false;
    };
  }, [short.id]);

  const playShort = () => {
    // Resolution starts on the click rather than after the route has changed and
    // the player has mounted; the surface that plays it joins this request.
    prefetchStreamInfo(short.id);
    if (disableShortsPlayer) {
      navigate(`/watch/${short.id}`);
      return;
    }

    navigate(`/shorts/${short.id}`, {
      state: {
        initialShort: shortSummaryToItem(short),
        initialQueue: buildShortQueue(queue),
        queueOnly: true,
      },
    });
  };

  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor({ top: event.clientY, left: event.clientX });
  };

  const openMenuFromDots = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: rect.right });
  };

  const copyLink = () => {
    setMenuAnchor(null);
    void navigator.clipboard?.writeText(`https://www.youtube.com/shorts/${short.id}`);
    showToast({ variant: "success", message: getString("shorts_link_copied") });
  };

  const toggleSavedShort = async () => {
    setMenuAnchor(null);
    try {
      if (savedToLibrary) {
        await removeShortFromLibrary(short.id);
        setSavedToLibrary(false);
        showToast({ variant: "success", message: getString("shorts_removed_from_library") });
        return;
      }

      await saveShortToLibrary({ ...short, title });
      setSavedToLibrary(true);
      showToast({ variant: "success", message: getString("shorts_saved_to_library") });
    } catch (error) {
      console.error("Failed to update saved Shorts", error);
      showToast({ variant: "error", message: getString("shorts_save_failed") });
    }
  };

  const notInterested = () => {
    setMenuAnchor(null);
    void notInterestedAction(video);
    showToast({ variant: "success", message: getString("shorts_not_interested") });
  };

  const dontRecommendChannel = () => {
    setMenuAnchor(null);
    if (!short.channelId) return;
    void blockChannelAction(video);
    showToast({ variant: "success", message: getString("shorts_channel_not_recommended") });
  };

  const downloadShort = () => {
    setMenuAnchor(null);
    showToast({ variant: "info", message: getString("shorts_download_coming_soon") });
  };

  const isShelf = variant === "shelf";

  return (
    <div
      onContextMenu={openContextMenu}
      className={[
        "group relative flex shrink-0 flex-col gap-2 text-left",
        isShelf ? "w-[140px] sm:w-[176px]" : "w-full",
      ].join(" ")}
    >
      <button type="button" onClick={playShort} className="flex w-full flex-col gap-2 text-left">
        <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container">
          {short.thumbnailUrl && (
            <img
              src={short.thumbnailUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          )}
          <span className="absolute inset-0 grid place-items-center bg-chrome-black/10 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-chrome-white">
              <Play size={isShelf ? 16 : 18} fill="currentColor" />
            </span>
          </span>
          {short.viewCountText && (
            <span className="absolute bottom-2 left-2 rounded bg-chrome-black/70 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-chrome-white">
              {short.viewCountText}
            </span>
          )}
        </span>

        <span
          className={[
            "line-clamp-2 font-semibold leading-tight text-chrome-neutral-100 transition-colors group-hover:text-primary",
            isShelf ? "text-xs" : "text-sm",
          ].join(" ")}
        >
          {title}
        </span>
      </button>

      <button
        type="button"
        aria-label={getString("more_options")}
        onClick={openMenuFromDots}
        className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full border border-chrome-white/15 bg-chrome-black/80 text-chrome-white opacity-0 transition-colors hover:bg-chrome-black group-hover:opacity-100"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {menuAnchor && (
        <AnchoredPortalMenu
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          className="z-50 w-64 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1"
        >
          <MenuItem icon={savedToLibrary ? BookmarkCheck : Bookmark} onClick={() => void toggleSavedShort()}>
            {getString(savedToLibrary ? "shorts_menu_remove_from_library" : "shorts_menu_save_to_library")}
          </MenuItem>
          <MenuItem icon={Download} onClick={downloadShort}>{getString("shorts_menu_download")}</MenuItem>
          <MenuItem icon={Ban} onClick={notInterested}>{getString("shorts_menu_not_interested")}</MenuItem>
          {short.channelId && (
            <MenuItem icon={EyeOff} onClick={dontRecommendChannel}>
              {getString("shorts_menu_dont_recommend_channel")}
            </MenuItem>
          )}
          <MenuItem icon={Copy} onClick={copyLink}>{getString("shorts_menu_copy_link")}</MenuItem>
        </AnchoredPortalMenu>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
    >
      <Icon className="h-4 w-4 shrink-0 text-chrome-neutral-400" />
      {children}
    </button>
  );
}

export default ShortCard;
