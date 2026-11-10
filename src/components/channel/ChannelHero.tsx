import React, { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { Button } from "../ui/Button";
import { SubscribeButton } from "../ui/SubscribeButton";
import { ChannelNote, ChannelNoteButton } from "../note/ChannelNote";
import type { ChannelDetails } from "../../types/video";
import { getString } from "../../lib/i18n/index";
import { upgradeAvatarUrl, upgradeChannelBannerUrl } from "../../lib/thumbnails";
import { shareLink } from "../../lib/clipboard";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { youtubeChannelUrl } from "../../lib/youtubeUrl";
import { useUiStore } from "../../store/useUiStore";
import { joinIsolated } from "../../lib/direction";

interface ChannelHeroProps {
  channelInfo: ChannelDetails;
  /** Opens the About panel; without it the description expands in place. */
  onOpenAbout?: () => void;
}

async function shareChannel(channel: ChannelDetails) {
  const result = await shareLink(channel.name, youtubeChannelUrl(channel.id));
  const { showToast } = useUiStore.getState();
  if (result === "copied") showToast({ variant: "success", message: getString("share_link_copied") });
  if (result === "failed") showToast({ variant: "error", message: getString("share_link_copy_failed") });
}

export const ChannelHero: React.FC<ChannelHeroProps> = ({ channelInfo, onOpenAbout }) => {
  const [descExpanded, setDescExpanded] = useState(false);
  const bannerUrl = useProxiedImageUrl(upgradeChannelBannerUrl(channelInfo.bannerUrl));
  const avatarUrl = useProxiedImageUrl(upgradeAvatarUrl(channelInfo.avatarUrl));
  const facts = [channelInfo.handle, channelInfo.subscriberCountText, channelInfo.videoCountText].filter(
    (fact): fact is string => !!fact,
  );

  return (
    <div className="flex w-full flex-col bg-background">
      <div className="relative h-48 w-full bg-surface-container-low md:h-64">
        {bannerUrl && (
          <img src={bannerUrl} alt={getString("channel_banner_alt")} className="h-full w-full object-cover" />
        )}
      </div>

      <div className="mx-auto w-full px-4 sm:px-6 lg:px-8">
        <div className="relative z-10 flex flex-col justify-between gap-6 pb-6 md:flex-row md:items-end">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-end">
            <div className="-mt-16 h-32 w-32 shrink-0 overflow-hidden rounded-full border-4 border-background bg-surface-container-high">
              {avatarUrl ? (
                <img src={avatarUrl} alt={channelInfo.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-chrome-neutral-500">
                  {channelInfo.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="mt-4 select-text space-y-1 pb-2 text-center md:mt-0 md:text-start">
              <h1 dir="auto" className="flex items-center justify-center gap-2 text-4xl font-bold tracking-tight text-chrome-neutral-100 md:justify-start">
                {channelInfo.name}
                {channelInfo.verified && (
                  <Check size={20} className="rounded-full bg-surface-container-high p-0.5 text-chrome-neutral-400" />
                )}
              </h1>
              {facts.length > 0 && <p className="font-medium text-chrome-neutral-400">{joinIsolated(facts, " · ")}</p>}
            </div>
          </div>

          <div className="mt-4 flex w-full shrink-0 items-center justify-center gap-3 pb-2 md:mt-0 md:w-auto md:justify-end">
            <SubscribeButton
              channelId={channelInfo.id}
              channelName={channelInfo.name}
              avatarUrl={avatarUrl || undefined}
              size="md"
            />
            <ChannelNoteButton channelInfo={channelInfo} />
            <Button variant="tonal" onClick={() => void shareChannel(channelInfo)}>
              <Share2 size={16} />
              {getString("share")}
            </Button>
          </div>
        </div>

        <ChannelNote channelInfo={channelInfo} />

        {channelInfo.description && (
          <button
            type="button"
            className="group mb-8 block max-w-3xl text-start"
            onClick={() => (onOpenAbout ? onOpenAbout() : setDescExpanded((open) => !open))}
          >
            <span dir="auto"
              className={`block text-sm leading-relaxed text-chrome-neutral-400 transition-colors group-hover:text-chrome-neutral-300 ${
                descExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
              }`}
            >
              {channelInfo.description}
            </span>
            {!descExpanded && (
              <span className="mt-1 block text-xs font-semibold text-chrome-neutral-500">
                {getString("channel_about_more")}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
