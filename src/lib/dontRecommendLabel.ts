import { getString } from "./i18n/index";

/** "Don't recommend" with who it's about, for a channel or an artist; names can hold `$`, so no plain replace. */
export function dontRecommendLabel(name: string | null | undefined): string {
  const shown = name?.trim();
  if (!shown) return getString("shorts_menu_dont_recommend_channel");
  return getString("music_dont_recommend_artist").replace("{artist}", () => shown);
}
