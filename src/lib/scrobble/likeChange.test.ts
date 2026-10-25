import { describe, expect, it } from "vitest";
import { likeChange } from "./likeChange";
import type { LikedItem } from "../../store/useLikesStore";
import type { SongItem } from "../../types/music";

const song = (id: string): SongItem => ({
  id,
  title: id,
  artists: [{ name: "Artist", id: null }],
  album: null,
  duration: 200,
  musicVideoType: null,
  thumbnail: "",
  explicit: false,
  videoId: id,
  playlistId: null,
  params: null,
});

const liked = (id: string): LikedItem => ({ kind: "music", id, likedAt: "2026-10-24T00:00:00Z", song: song(id) });
const video: LikedItem = {
  kind: "video",
  id: "v",
  likedAt: "2026-10-24T00:00:00Z",
  video: {} as never,
};

describe("likeChange", () => {
  it("reports one song liked or unliked", () => {
    const before = { loaded: true, items: [liked("a")] };
    expect(likeChange(before, { loaded: true, items: [liked("b"), liked("a")] })).toEqual({ song: song("b"), liked: true });
    expect(likeChange(before, { loaded: true, items: [] })).toEqual({ song: song("a"), liked: false });
  });

  it("ignores the library loading, bulk changes and video likes", () => {
    expect(likeChange({ loaded: false, items: [] }, { loaded: true, items: [liked("a")] })).toBeNull();
    expect(likeChange({ loaded: true, items: [] }, { loaded: true, items: [liked("a"), liked("b")] })).toBeNull();
    expect(likeChange({ loaded: true, items: [] }, { loaded: true, items: [video] })).toBeNull();
  });
});
