import { describe, expect, it } from "vitest";
import {
  buildSuggestionColumns,
  HISTORY_WHEN_EMPTY,
  isUnsupportedLink,
  matchHistory,
  musicItemShape,
  musicItemSubtitle,
  splitCompletion,
} from "./searchSuggestions";
import { getString } from "./i18n/index";
import { joinIsolated } from "./direction";
import type { YTItem } from "../types/music";

const history = (...queries: string[]) => queries.map((query, index) => ({ query, at: 1000 - index }));
const suggestion = (text: string) => ({ text, entity: null });

const song = (id: string, videoType = "MUSIC_VIDEO_TYPE_ATV"): YTItem => ({
  type: "song",
  id,
  videoId: id,
  title: `Song ${id}`,
  artists: [{ name: "The Weeknd", id: "UC1" }],
  album: null,
  duration: null,
  musicVideoType: videoType,
  thumbnail: `https://lh3.googleusercontent.com/${id}`,
  explicit: false,
  playlistId: null,
  params: null,
});
const artist: YTItem = { type: "artist", id: "UC1", title: "The Weeknd", thumbnail: null, channelId: "UC1" };

describe("matchHistory", () => {
  it("puts searches starting with the text before ones that only contain it", () => {
    expect(matchHistory(history("best of the weeknd", "the weeknd live", "Weeknd", "lofi"), "the w", 3))
      .toEqual(["the weeknd live", "best of the weeknd"]);
  });

  it("leaves out the exact query, which the box already shows", () => {
    expect(matchHistory(history("lofi", "lofi beats"), "LOFI ", 3)).toEqual(["lofi beats"]);
  });
});

describe("buildSuggestionColumns", () => {
  it("shows only recent searches for an empty box, then Show all", () => {
    const many = history(...Array.from({ length: 12 }, (_, i) => `q${i}`));
    const columns = buildSuggestionColumns({ query: " ", history: many, suggestions: [suggestion("x")], musicItems: [artist] });
    expect(columns.main.map((row) => row.kind)).toEqual([...Array(HISTORY_WHEN_EMPTY).fill("history"), "more"]);
    expect(columns.side).toEqual([]);
  });

  it("lists matching history first and never repeats it as a suggestion", () => {
    const columns = buildSuggestionColumns({
      query: "the weeknd",
      history: history("the weeknd blinding lights"),
      suggestions: [suggestion("The Weeknd Blinding Lights"), suggestion("the weeknd live")],
      musicItems: [],
    });
    expect(columns.main.map((row) => row.key)).toEqual([
      "history:the weeknd blinding lights",
      "query:the weeknd live",
    ]);
  });

  it("keeps openable music items once each, without hidden songs", () => {
    const columns = buildSuggestionColumns({
      query: "the weeknd",
      history: [],
      suggestions: [],
      musicItems: [artist, song("a"), song("a"), song("b"), { type: "episode" } as unknown as YTItem],
      isHiddenSong: (item) => item.id === "b",
    });
    expect(columns.side.map((row) => row.key)).toEqual(["artist:UC1", "song:a"]);
  });
});

describe("splitCompletion", () => {
  it("separates the typed start from the completion, ignoring case", () => {
    expect(splitCompletion("The Weeknd live", "the w")).toEqual({ typed: "The W", completion: "eeknd live" });
  });

  it("draws everything as completion when it does not start with the text", () => {
    expect(splitCompletion("best of the weeknd", "the")).toEqual({ typed: "", completion: "best of the weeknd" });
  });
});

describe("music item labels", () => {
  it("tells songs from videos and crops each kind", () => {
    const track = song("a") as Extract<YTItem, { type: "song" }>;
    const video = song("v", "MUSIC_VIDEO_TYPE_UGC") as Extract<YTItem, { type: "song" }>;
    expect(musicItemSubtitle(track)).toBe(joinIsolated([getString("search_kind_song"), "The Weeknd"], " · "));
    expect(musicItemSubtitle(video)).toBe(joinIsolated([getString("search_kind_video"), "The Weeknd"], " · "));
    expect(musicItemShape(video)).toBe("wide");
    const unattributed = { ...video, artists: [{ name: "Video", id: null }] };
    expect(musicItemSubtitle(unattributed)).toBe(joinIsolated([getString("search_kind_video")]));
    expect(musicItemShape(artist as Extract<YTItem, { type: "artist" }>)).toBe("circle");
  });
});

describe("history and links", () => {
  const filtered = { category: "videos" as const, sortBy: "relevance" as const, filters: { uploadDate: "week" as const, duration: "any" as const, features: ["4k" as const], watchState: "any" as const } };

  it("carries each past search's filters, and offers the rest of a long history", () => {
    const entries = [{ query: "sourdough", at: 3, filters: filtered }, ...history(...Array.from({ length: HISTORY_WHEN_EMPTY + 2 }, (_, i) => `q${i}`))];
    const { main } = buildSuggestionColumns({ query: "", history: entries, suggestions: [], musicItems: [] });
    expect(main[0]).toMatchObject({ kind: "history", query: "sourdough", filters: filtered });
    expect(main).toHaveLength(HISTORY_WHEN_EMPTY + 1);
    expect(main[main.length - 1]).toMatchObject({ kind: "more", count: entries.length });
    const all = buildSuggestionColumns({ query: "", history: entries, suggestions: [], musicItems: [], allHistory: true });
    expect(all.main).toHaveLength(entries.length);
  });

  it("offers to open a pasted link, and to search for it instead", () => {
    const { main, side } = buildSuggestionColumns({
      query: "https://youtu.be/dQw4w9WgXcQ",
      history: [],
      suggestions: [suggestion("never")],
      musicItems: [],
    });
    expect(main.map((row) => row.kind)).toEqual(["link", "query"]);
    expect(side).toEqual([]);
  });

  it("tells a link Flow can't open from plain text", () => {
    expect(isUnsupportedLink("https://example.com/watch")).toBe(true);
    expect(isUnsupportedLink("www.example.com/page")).toBe(true);
    expect(isUnsupportedLink("node.js/express")).toBe(false);
    expect(isUnsupportedLink("3.5/10")).toBe(false);
    expect(isUnsupportedLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isUnsupportedLink("lofi beats")).toBe(false);
  });
});
