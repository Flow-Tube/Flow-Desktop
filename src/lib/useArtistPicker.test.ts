import { describe, expect, it } from "vitest";
import { chartArtists, toFavouriteArtists } from "./useArtistPicker";
import type { ArtistItem, ChartsPage, YTItem } from "../types/music";

const artist = (id: string, isProfile = false): ArtistItem => ({
  id,
  title: id,
  thumbnail: null,
  channelId: null,
  isProfile,
});

describe("artist picker", () => {
  it("leaves out plain channels", () => {
    expect(toFavouriteArtists([artist("a"), artist("p", true)])).toEqual([{ id: "a", name: "a", thumbnailUrl: "" }]);
  });

  it("reads artists out of any chart section", () => {
    const page = {
      sections: [
        { title: "Songs", chartType: "Songs", items: [{ type: "song", id: "s" } as unknown as YTItem] },
        { title: "Artists", chartType: "Artists", items: [{ type: "artist", ...artist("a") } as unknown as YTItem] },
      ],
      countryCode: null,
      countryLabel: null,
      continuation: null,
    } as ChartsPage;
    expect(chartArtists(page).map((item) => item.id)).toEqual(["a"]);
  });
});
