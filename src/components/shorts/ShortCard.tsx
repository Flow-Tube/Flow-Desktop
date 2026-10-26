import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import type { MenuAnchor } from "../ui/AnchoredPortalMenu";
import { MediaMenu } from "../ui/MediaMenu";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";
import { useFeedActionsStore } from "../../store/useFeedActionsStore";
import { useUiStore } from "../../store/useUiStore";
import { showSaveFailedToast, showSaveToast } from "../../lib/saveToast";
import { SETTINGS } from "../../lib/settings/schema";
import { buildShortQueue, shortSummaryToItem } from "../../lib/shortsQueue";
import { prefetchStreamInfo } from "../../lib/streamResolution";
import {
  isShortSaved,
  removeShortFromLibrary,
  saveShortToLibrary,
} from "../../lib/savedShortsLibrary";
import { getString } from "../../lib/i18n/index";
import { youtubeShortsUrl } from "../../lib/youtubeUrl";
import { copyText } from "../../lib/clipboard";
import { useProxyImageSrc } from "../../lib/useImageProxy";
import type { ShortVideoSummary, VideoSummary } from "../../types/video";

interface ShortCardProps {
  short: ShortVideoSummary;
  queue: ShortVideoSummary[];
  variant?: "shelf" | "grid";
}

export function ShortCard({ short, queue, variant = "grid" }: ShortCardProps) {
  const navigate = useNavigate();
  const toSrc = useProxyImageSrc();
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

  const copyLink = async () => {
    setMenuAnchor(null);
    const copied = await copyText(youtubeShortsUrl(short.id));
    showToast({
      variant: copied ? "success" : "error",
      message: getString(copied ? "shorts_link_copied" : "share_link_copy_failed"),
    });
  };

  const toggleSavedShort = async () => {
    setMenuAnchor(null);
    const removing = savedToLibrary;
    const item = { title, image: short.thumbnailUrl, shape: "portrait" as const };
    try {
      if (removing) {
        await removeShortFromLibrary(short.id);
        setSavedToLibrary(false);
        showSaveToast({
          destination: { kind: "savedShorts" },
          item,
          removed: true,
          undo: async () => {
            await saveShortToLibrary({ ...short, title });
            setSavedToLibrary(true);
          },
        });
        return;
      }

      await saveShortToLibrary({ ...short, title });
      setSavedToLibrary(true);
      showSaveToast({
        destination: { kind: "savedShorts" },
        item,
        undo: async () => {
          await removeShortFromLibrary(short.id);
          setSavedToLibrary(false);
        },
      });
    } catch (error) {
      console.error("Failed to update saved Shorts", error);
      showSaveFailedToast({ destination: { kind: "savedShorts" }, item, removed: removing, retry: toggleSavedShort });
    }
  };

  const notInterested = () => {
    setMenuAnchor(null);
    void notInterestedAction(video).catch(() => showToast({ variant: "error", message: getString("feed_action_failed") }));
    showToast({ variant: "success", message: getString("shorts_not_interested") });
  };

  const dontRecommendChannel = () => {
    setMenuAnchor(null);
    if (!short.channelId) return;
    void blockChannelAction(video).catch(() => showToast({ variant: "error", message: getString("feed_action_failed") }));
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
              src={toSrc(short.thumbnailUrl)}
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
        <MediaMenu
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          header={{
            title,
            subtitle: short.channelName,
            image: short.thumbnailUrl ? toSrc(short.thumbnailUrl) : null,
            imageShape: "portrait",
          }}
          actions={[
            {
              id: "save",
              label: getString(savedToLibrary ? "shorts_menu_remove_from_library" : "shorts_menu_save_to_library"),
              tileLabel: getString(savedToLibrary ? "menu_tile_saved" : "menu_tile_save"),
              icon: savedToLibrary ? <BookmarkCheck size={18} /> : <Bookmark size={18} />,
              group: "quick",
              active: savedToLibrary,
              onSelect: toggleSavedShort,
            },
            {
              id: "download",
              label: getString("shorts_menu_download"),
              tileLabel: getString("menu_tile_download"),
              icon: <Download size={18} />,
              group: "quick",
              onSelect: downloadShort,
            },
            {
              id: "copy-link",
              label: getString("shorts_menu_copy_link"),
              tileLabel: getString("menu_tile_copy_link"),
              icon: <Copy size={18} />,
              group: "quick",
              onSelect: copyLink,
            },
            {
              id: "not-interested",
              label: getString("shorts_menu_not_interested"),
              icon: <Ban size={16} />,
              group: "feed",
              onSelect: notInterested,
            },
            ...(short.channelId
              ? [{
                id: "block-channel",
                label: getString("shorts_menu_dont_recommend_channel"),
                icon: <EyeOff size={16} />,
                group: "feed" as const,
                onSelect: dontRecommendChannel,
              }]
              : []),
          ]}
        />
      )}
    </div>
  );
}

export default ShortCard;
