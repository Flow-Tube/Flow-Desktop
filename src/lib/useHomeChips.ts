import { useCallback, useEffect, useRef, useState } from "react";
import { getHomeChipFeed, getHomeChips, type HomeCard, type InterestChip } from "./api/homeFeed";
import { getString, type StringKey } from "./i18n/index";

export const ALL_CHIP = "all";
export const NEW_TO_YOU_CHIP = "new";
export const RECENT_CHIP = "recent";

export const interestChipKey = (chip: InterestChip) => `interest:${chip.key}`;

const THEME_LABELS: Record<string, StringKey> = {
  music: "home_theme_music",
  gaming: "home_theme_gaming",
  sports: "home_theme_sports",
  education: "home_theme_education",
  news: "home_theme_news",
  science: "home_theme_science",
  comedy: "home_theme_comedy",
  film: "home_theme_film",
  autos: "home_theme_autos",
  pets: "home_theme_pets",
  travel: "home_theme_travel",
  howto: "home_theme_howto",
  nonprofits: "home_theme_nonprofits",
};

/** A chip's name: a theme reads as its category ("Gaming"), any other as its strongest topic. */
export function interestChipLabel(chip: InterestChip): string {
  const theme = chip.category ? THEME_LABELS[chip.category] : undefined;
  return theme ? getString(theme) : chip.label;
}

export type ChipFeedState =
  | { status: "loading" }
  | { status: "ready"; cards: HomeCard[] }
  | { status: "failed" };

/** The chip to show again: the one chosen before, unless it was an interest that is no longer a chip. */
export function chipToRestore(remembered: string, interests: InterestChip[]): string {
  const fixed = remembered === ALL_CHIP || remembered === NEW_TO_YOU_CHIP || remembered === RECENT_CHIP;
  return fixed || interests.some((chip) => interestChipKey(chip) === remembered) ? remembered : ALL_CHIP;
}

// The chosen chip outlives the page, as Home itself does, so coming back finds it still chosen.
let rememberedChip = ALL_CHIP;

/** Home's chips: the interest chips the backend picks, the chosen one and its videos. */
export function useHomeChips(enabled: boolean) {
  const [interests, setInterests] = useState<InterestChip[]>([]);
  const [selected, setSelected] = useState(rememberedChip);
  const [feed, setFeed] = useState<ChipFeedState | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (key: string, refresh: boolean) => {
    const request = ++requestRef.current;
    if (key === ALL_CHIP) {
      setFeed(null);
      return;
    }
    setFeed((current) => (refresh && current?.status === "ready" ? current : { status: "loading" }));
    try {
      const result = await getHomeChipFeed(key, refresh);
      if (request !== requestRef.current) return;
      setFeed(result.failed ? { status: "failed" } : { status: "ready", cards: result.cards });
    } catch (error) {
      console.error("Home chip failed to load", error);
      if (request === requestRef.current) setFeed({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void getHomeChips()
      .then((chips) => {
        if (disposed) return;
        setInterests(chips);
        const key = chipToRestore(rememberedChip, chips);
        rememberedChip = key;
        setSelected(key);
        void load(key, false);
      })
      .catch((error) => console.error("Home chips failed to load", error));
    return () => {
      disposed = true;
    };
  }, [enabled, load]);

  const select = useCallback(
    (key: string) => {
      rememberedChip = key;
      setSelected(key);
      void load(key, false);
    },
    [load],
  );

  const reload = useCallback(() => {
    void load(rememberedChip, true);
  }, [load]);

  return { interests, selected, feed, select, reload };
}
