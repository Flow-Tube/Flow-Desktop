import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
const music = vi.hoisted(() => ({ setFavouriteMusicArtist: vi.fn() }));
const recommendation = vi.hoisted(() => ({ logInteraction: vi.fn() }));
vi.mock("../lib/api/db", () => db);
vi.mock("../lib/api/music", () => music);
vi.mock("../lib/api/recommendation", () => recommendation);

import { useFavouriteArtistsStore } from "./useFavouriteArtistsStore";

const artist = { id: "UC1", name: "Artist", thumbnailUrl: "" };

describe("picked artists", () => {
  beforeEach(() => {
    useFavouriteArtistsStore.setState({ picked: [], loaded: false });
    db.setSetting.mockReset().mockResolvedValue(undefined);
    music.setFavouriteMusicArtist.mockReset().mockResolvedValue(undefined);
    recommendation.logInteraction.mockReset();
  });

  it("seeds the music brain and keeps the pick", async () => {
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(music.setFavouriteMusicArtist).toHaveBeenCalledWith("UC1", "Artist", true);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([artist]);
    expect(db.setSetting).toHaveBeenCalledWith("favourite_artists", JSON.stringify([artist]));
  });

  it("never teaches the video engine", async () => {
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(recommendation.logInteraction).not.toHaveBeenCalled();
  });

  it("unpicks", async () => {
    useFavouriteArtistsStore.setState({ picked: [artist] });
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(music.setFavouriteMusicArtist).toHaveBeenCalledWith("UC1", "Artist", false);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([]);
  });

  it("goes back when the music brain fails", async () => {
    music.setFavouriteMusicArtist.mockRejectedValue(new Error("gone"));
    await useFavouriteArtistsStore.getState().toggle(artist);
    expect(useFavouriteArtistsStore.getState().picked).toEqual([]);
  });
});
