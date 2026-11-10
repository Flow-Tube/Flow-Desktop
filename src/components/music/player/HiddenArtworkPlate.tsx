import { upgradeMusicImageUrl } from "../../../lib/thumbnails";
import { useDominantColor } from "../../../lib/useDominantColor";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import type { SongItem } from "../../../types/music";

/** Stands in for the cover when it is hidden: the app icon on the artwork's own color. */
export function HiddenArtworkPlate({ track }: { track: SongItem }) {
  const src = useProxiedImageUrl(upgradeMusicImageUrl(track.thumbnail, 320));
  const color = useDominantColor(src);
  return (
    <div
      aria-hidden="true"
      className="grid h-full w-full place-items-center rounded-2xl bg-surface-container-high transition-colors duration-300 ease-out"
      style={color ? { backgroundColor: `rgb(${color.r} ${color.g} ${color.b})` } : undefined}
    >
      <img src="/logo.svg" alt="" className="h-1/4 w-1/4" />
    </div>
  );
}
