import { describe, expect, it } from "vitest";
import type { SongItem, YTItem } from "../../types/music";
import { AI_LIST_MATCHER_NONE, createAiListMatcher, toAiLists } from "./matcher";
import { aiHidesRecommended, aiHidesSong, withoutAiMusic } from "./music";

const AI = "UCaaaaaaaaaaaaaaaaaaaaaa";
const REAL = "UCrrrrrrrrrrrrrrrrrrrrrr";
const ai = createAiListMatcher(
  toAiLists({ handles: [], ids: [] }, { handles: [], ids: [] }, { handles: [], ids: [AI] }),
  { blockEnabled: false, warnEnabled: false, musicEnabled: true, exemptIds: new Set(), exemptHandles: new Set() },
  null,
);
const song = (id: string, artistId: string) => ({ id, title: id, artists: [{ id: artistId, name: artistId }] }) as SongItem;
const item = (value: object) => value as YTItem;

describe("AI music filters", () => {
  it("hides a radio song by a listed artist", () => {
    expect(aiHidesSong(ai, song("a", AI))).toBe(true);
    expect(aiHidesSong(ai, song("b", REAL))).toBe(false);
    expect(aiHidesSong(AI_LIST_MATCHER_NONE, song("a", AI))).toBe(false);
  });

  it("drops recommended artist cards, albums and playlists, but keeps artist cards in search", () => {
    const artist = item({ type: "artist", id: AI, title: "AI band" });
    const album = item({ type: "album", browseId: "A1", title: "A1", artists: [{ id: AI, name: "x" }] });
    const playlist = item({ type: "playlist", id: "P1", title: "P1", author: { id: AI, name: "x" } });
    for (const listed of [artist, album, playlist]) expect(aiHidesRecommended(ai, listed)).toBe(true);
    expect(withoutAiMusic([artist, album, playlist], ai)).toEqual([artist]);
  });

  it("returns the same array when nothing is hidden", () => {
    const items = [item({ ...song("b", REAL), type: "song" })];
    expect(withoutAiMusic(items, ai)).toBe(items);
  });
});
