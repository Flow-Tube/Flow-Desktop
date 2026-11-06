import { upgradeAvatarUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

export function getAvatarUrl(url?: string | null) {
  const normalized = upgradeAvatarUrl(url);
  if (!normalized?.startsWith("http")) return undefined;
  if (/ytimg\.com\/vi\//i.test(normalized)) return undefined;
  return normalized;
}

export function ChannelAvatarImage({ src, name }: { src?: string | null; name: string }) {
  const imageSrc = useProxiedImageUrl(upgradeAvatarUrl(src));
  if (!imageSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-container-high text-sm font-semibold text-chrome-neutral-400">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return <img src={imageSrc} alt={name} className="h-full w-full object-cover" />;
}
