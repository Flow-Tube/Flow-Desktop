import { useCallback, useEffect, useRef, useState } from "react";
import {
  NO_HOME_CHIPS,
  getHomeChipFeed,
  getHomeChips,
  type HomeCard,
  type HomeChips,
  type HomeMix,
  type InterestChip,
} from "./api/homeFeed";
import { getString, type StringKey } from "./i18n/index";
import type { VideoSummary } from "../types/video";

export const ALL_CHIP = "all";
export const NEW_TO_YOU_CHIP = "new";
export const RECENT_CHIP = "recent";
export const MIXES_CHIP = "mixes";
export const LIVE_CHIP = "live";
export const WATCHED_CHIP = "watched";

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

/** The backend's shortest mix, which a hidden video can take a mix below. */
const MIX_MIN_VIDEOS = 5;

/** Mixes come from a backend cache that doesn't hear about what was hidden since. */
export function visibleHomeMixes(mixes: HomeMix[], isHidden: (video: VideoSummary) => boolean): HomeMix[] {
  return mixes.flatMap((mix) => {
    if (isHidden(mix.seed)) return [];
    const videos = mix.videos.filter((video) => !isHidden(video));
    return videos.length >= MIX_MIN_VIDEOS ? [{ ...mix, videos }] : [];
  });
}

export type ChipFeedState =
  | { status: "loading" }
  | { status: "ready"; cards: HomeCard[]; mixes: HomeMix[] }
  | { status: "failed" };

/** The order chips appear in, which never changes. Chips with nothing to show stay out, unless chosen. */
export function visibleChipKeys(chips: HomeChips, selected: string): string[] {
  const empty = new Set(chips.empty);
  const offered = (key: string, available = true) => key === selected || (available && !empty.has(key));
  return [
    ALL_CHIP,
    ...chips.interests.map(interestChipKey).filter((key) => offered(key)),
    ...[NEW_TO_YOU_CHIP, RECENT_CHIP].filter((key) => offered(key)),
    ...(offered(MIXES_CHIP, chips.hasMixes) ? [MIXES_CHIP] : []),
    ...(offered(LIVE_CHIP) ? [LIVE_CHIP] : []),
    ...(offered(WATCHED_CHIP, chips.hasWatched) ? [WATCHED_CHIP] : []),
  ];
}

/** The chip to show again: the one chosen before, unless it has left the chips. */
export function chipToRestore(remembered: string, chips: HomeChips): string {
  return visibleChipKeys(chips, ALL_CHIP).includes(remembered) ? remembered : ALL_CHIP;
}

// The chosen chip outlives the page, as Home itself does, so coming back finds it still chosen.
let rememberedChip = ALL_CHIP;

/** Home's chips: the interest chips the backend picks, the chosen one and its videos. */
export function useHomeChips(enabled: boolean) {
  const [chips, setChips] = useState<HomeChips>(NO_HOME_CHIPS);
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
      setFeed(result.failed ? { status: "failed" } : { status: "ready", cards: result.cards, mixes: result.mixes });
    } catch (error) {
      console.error("Home chip failed to load", error);
      if (request === requestRef.current) setFeed({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void getHomeChips()
      .then((next) => {
        if (disposed) return;
        setChips(next);
        const key = chipToRestore(rememberedChip, next);
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

  return { chips, selected, feed, select, reload };
}
