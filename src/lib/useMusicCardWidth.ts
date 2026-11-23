import { SETTINGS } from "./settings/schema";
import { usePreference } from "./usePreference";

const BIG = "w-40 md:w-48 lg:w-56";
const SMALL = "w-28 md:w-32 lg:w-40";

export const musicCardWidth = (size: string): string => (size === "small" ? SMALL : BIG);

/** The widest a music shelf card is drawn, in CSS px: `lg:w-40` or `lg:w-56`. */
export const musicCardMaxPx = (size: string): number => (size === "small" ? 160 : 224);

/** The width of album and song cards on music shelves, from Music artwork size. */
export function useMusicCardWidth(): string {
  const [size] = usePreference(SETTINGS.MUSIC_ARTWORK_SIZE);
  return musicCardWidth(size);
}

/** The widest those cards are drawn, in CSS px, for sizing their artwork. */
export function useMusicCardMaxPx(): number {
  const [size] = usePreference(SETTINGS.MUSIC_ARTWORK_SIZE);
  return musicCardMaxPx(size);
}
