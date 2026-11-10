import { useEffect, useState } from "react";
import { getMusicChartsPage, searchMusicTyped } from "./api/music";
import { bucketMusicSections } from "./searchResults";
import { useDebounce } from "./useDebounce";
import type { FavouriteArtist } from "../store/useFavouriteArtistsStore";
import type { ArtistItem, ChartsPage } from "../types/music";

const SEARCH_DEBOUNCE_MS = 300;

/** Real artists to pick from: a plain channel ("Profile") has no music taste to seed. */
export function toFavouriteArtists(items: ArtistItem[]): FavouriteArtist[] {
  return items
    .filter((item) => !item.isProfile)
    .map((item) => ({ id: item.id, name: item.title, thumbnailUrl: item.thumbnail ?? "" }));
}

export function chartArtists(page: ChartsPage): ArtistItem[] {
  return page.sections
    .flatMap((section) => section.items)
    .filter((item): item is Extract<typeof item, { type: "artist" }> => item.type === "artist");
}

/** The chart's artists while nothing is typed, search results otherwise; null while loading. */
export function useArtistPicker(query: string) {
  const [candidates, setCandidates] = useState<FavouriteArtist[] | null>(null);
  const [failed, setFailed] = useState(false);
  const debounced = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    let active = true;
    setCandidates(null);
    setFailed(false);
    const request = debounced
      ? searchMusicTyped(debounced, "artists").then((res) => bucketMusicSections(res.sections).artists)
      : getMusicChartsPage().then(chartArtists);
    request
      .then((items) => {
        if (active) setCandidates(toFavouriteArtists(items));
      })
      .catch((error) => {
        console.warn("Failed to load artists to pick from", error);
        if (active) {
          setCandidates([]);
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [debounced]);

  return { candidates, failed, searching: debounced.length > 0 };
}
