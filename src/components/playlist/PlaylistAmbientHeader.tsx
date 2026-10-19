import {
  Check,
  Download,
  Link2,
  ListPlus,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { SoftBackdrop } from "../ui/SoftBackdrop";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { getString } from "../../lib/i18n/index";
import type { PlaylistDetailsMeta } from "../../lib/usePlaylistDetails";
import { useVideoThumbnail } from "../../lib/useVideoThumbnail";

interface PlaylistAmbientHeaderProps {
  meta: PlaylistDetailsMeta;
  heroVideoId?: string | null;
  heroThumbnailUrl: string | null;
  onPlayAll: () => void;
  onShuffle: () => void;
  canPlay: boolean;
  onDownload?: () => void;
  downloadActive?: boolean;
  downloadComplete?: boolean;
  onAddToQueue?: () => void;
  onCopyLink?: () => void;
  onSaveToLibrary?: () => void;
  onRemoveFromLibrary?: () => void;
  isSaved?: boolean;
  isProtected?: boolean;
  isOwned?: boolean;
}

function PlaylistMenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-sm transition-colors ${
        destructive
          ? "text-red-400 hover:bg-surface-container-highest"
          : "text-chrome-neutral-300 hover:bg-surface-container-highest hover:text-chrome-neutral-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function isUnknownOwner(name: string) {
  return name.trim().toLowerCase() === "unknown owner";
}

export function PlaylistAmbientHeader({
  meta,
  heroVideoId,
  heroThumbnailUrl,
  onPlayAll,
  onShuffle,
  canPlay,
  onDownload,
  downloadActive,
  downloadComplete,
  onAddToQueue,
  onCopyLink,
  onSaveToLibrary,
  onRemoveFromLibrary,
  isSaved = false,
  isProtected = false,
  isOwned = false,
}: PlaylistAmbientHeaderProps) {
  const { src: ambientSrc, onError: onThumbnailError } = useVideoThumbnail(
    heroVideoId,
    heroThumbnailUrl,
    "large",
  );
  const ownerLabel = isUnknownOwner(meta.channelName) ? null : meta.channelName;

  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

  const toggleMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAnchor((current) =>
      current ? null : { top: rect.bottom + 4, right: rect.right },
    );
  }, []);

  const runAction = useCallback((action?: () => void) => {
    setMenuAnchor(null);
    action?.();
  }, []);

  const canAddToQueue = canPlay && Boolean(onAddToQueue);
  const canCopyLink = !isProtected && Boolean(onCopyLink);
  const canSave = !isProtected && !isSaved && Boolean(onSaveToLibrary);
  const canRemove = !isProtected && isSaved && Boolean(onRemoveFromLibrary);
  const showMenuDivider = (canAddToQueue || canCopyLink) && (canSave || canRemove);
  const hasMenuItems = canAddToQueue || canCopyLink || canSave || canRemove;

  const statsParts = [
    meta.videoCountText,
    meta.viewCountText,
    meta.updatedLabel,
  ].filter((part): part is string => Boolean(part?.trim()));

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl p-6">
        {ambientSrc ? (
          <>
            <SoftBackdrop
              src={ambientSrc}
              detail={12}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60"
              onError={onThumbnailError}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-[var(--color-surface)]"
            />
          </>
        ) : (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-surface-container"
          />
        )}

        <div className="relative z-10 flex h-full min-h-0 flex-col gap-6">
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-2xl border border-chrome-neutral-800/50 bg-chrome-neutral-950">
            {ambientSrc ? (
              <img
                src={ambientSrc}
                alt={meta.title}
                className="h-full w-full object-cover"
                onError={onThumbnailError}
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-chrome-neutral-500">
                Playlist
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
              {meta.title}
            </h1>
            {ownerLabel ? (
              <p className="mt-2 text-sm font-medium text-chrome-neutral-200">
                {ownerLabel}
              </p>
            ) : null}
            {statsParts.length > 0 ? (
              <p className="mt-1 text-sm text-chrome-neutral-300">
                {statsParts.join(" • ")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              aria-label={getString("downloads_download_playlist")}
              title={getString(
                downloadComplete
                  ? "downloaded"
                  : downloadActive
                    ? "downloads_downloading"
                    : "downloads_download_playlist",
              )}
              onClick={onDownload}
              disabled={!onDownload || downloadActive}
            >
              {downloadActive ? (
                <Loader2 size={18} className="animate-spin" />
              ) : downloadComplete ? (
                <Check size={18} className="text-[var(--color-primary)]" />
              ) : (
                <Download size={18} />
              )}
            </IconButton>
            <IconButton
              aria-label="Playlist menu"
              onClick={toggleMenu}
              disabled={!hasMenuItems}
            >
              <MoreVertical size={18} />
            </IconButton>
          </div>

          {menuAnchor && hasMenuItems && (
            <AnchoredPortalMenu
              anchor={menuAnchor}
              onClose={() => setMenuAnchor(null)}
              className="z-50 w-56 rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
            >
              {canAddToQueue && (
                <PlaylistMenuItem
                  icon={<ListPlus size={16} />}
                  label="Add to queue"
                  onClick={() => runAction(onAddToQueue)}
                />
              )}
              {canCopyLink && (
                <PlaylistMenuItem
                  icon={<Link2 size={16} />}
                  label="Copy link"
                  onClick={() => runAction(onCopyLink)}
                />
              )}
              {showMenuDivider && (
                <div className="my-1 h-px bg-chrome-neutral-800" />
              )}
              {canSave && (
                <PlaylistMenuItem
                  icon={<Plus size={16} />}
                  label="Save to library"
                  onClick={() => runAction(onSaveToLibrary)}
                />
              )}
              {canRemove && (
                <PlaylistMenuItem
                  icon={<Trash2 size={16} />}
                  label={isOwned ? "Delete playlist" : "Remove from library"}
                  destructive
                  onClick={() => runAction(onRemoveFromLibrary)}
                />
              )}
            </AnchoredPortalMenu>
          )}

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={!canPlay}
              onClick={onPlayAll}
              className="!bg-chrome-neutral-100 !text-chrome-neutral-950 hover:!opacity-90"
            >
              <Play size={18} fill="currentColor" />
              Play All
            </Button>
            <Button
              variant="tonal"
              size="lg"
              disabled={!canPlay}
              onClick={onShuffle}
            >
              <Shuffle size={18} />
              Shuffle
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
