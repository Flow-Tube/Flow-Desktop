import { useNavigate } from "react-router-dom";
import { Music2 } from "lucide-react";
import { useChannelAvatar } from "../../lib/useChannelAvatar";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { formatCount } from "../../lib/utils";
import { SubscribeButton } from "../ui/SubscribeButton";
import type { ShortItem } from "../../types/shorts";
import type { VideoDetails } from "../../types/video";

interface ShortMetadataProps {
  short: ShortItem;
  details?: VideoDetails | null;
  onOpenDescription: () => void;
}

export function ShortMetadata({
  short,
  details,
  onOpenDescription,
}: ShortMetadataProps) {
  const navigate = useNavigate();
  const channelId = short.channelId ?? details?.channelId ?? null;
  const fetchedAvatar = useChannelAvatar(channelId);
  const avatar = useProxiedImageUrl(upgradeAvatarUrl(short.channelAvatarUrl ?? fetchedAvatar));
  const title = short.title.trim() && short.title !== "Short" ? short.title : details?.title || short.title;
  const channelName = short.channelName.trim() || details?.channelName || "Unknown channel";
  const viewText = formatCount(short.viewCountText ?? details?.viewCountText);
  const viewStatText = viewText ? `${viewText} views` : null;

  return (
    <div className="mb-4 flex w-[260px] flex-col gap-4 lg:w-[280px]">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => short.channelId && navigate(`/channel/${short.channelId}`)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface-container-high text-base font-bold text-chrome-neutral-300">
              {channelName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="truncate text-lg font-bold text-chrome-neutral-100 hover:text-chrome-white">
            {channelName}
          </span>
        </button>

        {channelId && (
          <SubscribeButton
            channelId={channelId}
            channelName={channelName}
            avatarUrl={avatar || undefined}
            size="sm"
            className="shrink-0 !bg-chrome-white !px-4 !py-1.5 !text-sm !font-bold !text-chrome-black hover:!bg-chrome-neutral-200"
          />
        )}
      </div>

      <button
        type="button"
        className="line-clamp-4 text-left text-base leading-relaxed text-chrome-neutral-200 transition-colors hover:text-chrome-white"
        onClick={onOpenDescription}
      >
        {title}
      </button>

      {viewStatText && (
        <span className="w-fit rounded-full bg-chrome-black/60 px-2.5 py-1 text-xs font-semibold text-chrome-neutral-300">
          {viewStatText}
        </span>
      )}

      <div className="inline-flex w-fit items-center gap-2 rounded-full bg-chrome-black/60 px-3 py-1.5 text-xs text-chrome-neutral-300">
        <Music2 className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[220px] truncate lg:max-w-[240px]">
          Original audio - {channelName}
        </span>
      </div>
    </div>
  );
}
