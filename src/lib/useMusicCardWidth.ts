import { SETTINGS } from "./settings/schema";
import { usePreference } from "./usePreference";

const BIG = "w-40 md:w-48 lg:w-56";
const SMALL = "w-28 md:w-32 lg:w-40";

export const musicCardWidth = (size: string): string => (size === "small" ? SMALL : BIG);

/** The width of album and song cards on music shelves, from Music artwork size. */
export function useMusicCardWidth(): string {
  const [size] = usePreference(SETTINGS.MUSIC_ARTWORK_SIZE);
  return musicCardWidth(size);
}
