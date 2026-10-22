import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { SubscribeButton } from "../ui/SubscribeButton";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";
import { ChannelLabel } from "../video/CardMeta";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { getString } from "../../lib/i18n/index";
import { collaboratorsByline } from "../../lib/collaborators";
import type { Collaborator } from "../../types/video";

export interface WatchOwnerProps {
  channelId: string;
  channelName: string;
  avatarUrl: string | null;
  subscriberText: string | null;
  badge: "verified" | "artist" | null;
  /** Two or more channels for a collaboration, the uploader first. */
  collaborators: Collaborator[];
}

function Avatar({ url, name, className }: { url: string | null | undefined; name: string; className: string }) {
  const src = useProxiedImageUrl(upgradeAvatarUrl(url ?? null)) || null;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-chrome-neutral-400 ${className}`}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

/** The channel block beside the actions: one channel, or every channel of a collaboration. */
export function WatchOwner({ channelId, channelName, avatarUrl, subscriberText, badge, collaborators }: WatchOwnerProps) {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const goToChannel = (id: string) => {
    if (id) navigate(`/channel/${id}`);
  };

  if (collaborators.length < 2) {
    return (
      <div className="flex shrink-0 items-center gap-3">
        <button onClick={() => goToChannel(channelId)} className="transition-opacity hover:opacity-80">
          <Avatar url={avatarUrl} name={channelName} className="h-10 w-10" />
        </button>
        <button onClick={() => goToChannel(channelId)} className="min-w-0 pr-2 text-left">
          <span className="block text-[15px] font-medium leading-tight text-chrome-neutral-100 transition-colors hover:text-primary">
            <ChannelLabel name={channelName} verified={badge === "verified"} artist={badge === "artist"} iconSize={14} />
          </span>
          {subscriberText && <span className="block text-sm text-chrome-neutral-400">{subscriberText}</span>}
        </button>
        {channelId && <SubscribeButton channelId={channelId} channelName={channelName} avatarUrl={avatarUrl || undefined} />}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { top: rect.bottom + 6, left: rect.left });
        }}
        aria-expanded={Boolean(anchor)}
        className="flex min-w-0 items-center gap-3 rounded-full pr-2 text-left transition-opacity hover:opacity-90"
      >
        <span className="flex -space-x-3">
          {collaborators.slice(0, 2).map((collaborator) => (
            <Avatar
              key={collaborator.channelId}
              url={collaborator.avatarUrl}
              name={collaborator.name}
              className="h-10 w-10 border-2 border-surface"
            />
          ))}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[15px] font-medium leading-tight text-chrome-neutral-100">
            <span className="truncate">{collaboratorsByline(collaborators)}</span>
            <ChevronDown size={14} className="shrink-0 text-chrome-neutral-400" />
          </span>
          <span className="block text-sm text-chrome-neutral-400">
            {getString("watch_collaborators_count", collaborators.length)}
          </span>
        </span>
      </button>

      {anchor && (
        <AnchoredPortalMenu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          className="z-[70] w-80 overflow-hidden rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <div className="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("watch_collaborators")}
          </div>
          {collaborators.map((collaborator) => (
            <div key={collaborator.channelId} className="flex items-center gap-3 px-3.5 py-2">
              <button
                onClick={() => {
                  setAnchor(null);
                  goToChannel(collaborator.channelId);
                }}
                className="flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity hover:opacity-80"
              >
                <Avatar url={collaborator.avatarUrl} name={collaborator.name} className="h-9 w-9" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-chrome-neutral-100">{collaborator.name}</span>
                  {(collaborator.handle || collaborator.subscriberCountText) && (
                    <span className="block truncate text-xs text-chrome-neutral-400">
                      {[collaborator.handle, collaborator.subscriberCountText].filter(Boolean).join(" • ")}
                    </span>
                  )}
                </span>
              </button>
              <SubscribeButton
                channelId={collaborator.channelId}
                channelName={collaborator.name}
                avatarUrl={collaborator.avatarUrl || undefined}
                size="sm"
                showNotificationMenu={false}
              />
            </div>
          ))}
        </AnchoredPortalMenu>
      )}
    </div>
  );
}
