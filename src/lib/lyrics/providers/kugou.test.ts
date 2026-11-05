import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ downloads: [] as number[] }));
const answers = vi.hoisted(() => ({
  songs: [] as Array<{ hash: string; songname: string; singername: string; duration: number }>,
  keyword: [] as Array<{ id: number; accesskey: string; song: string; singer: string; duration: number }>,
  lrc: new Map<number, string>(),
}));

vi.mock("../http", () => ({
  enc: encodeURIComponent,
  lyricsGetJson: async (url: string) => {
    if (url.includes("/search/song")) return { data: { info: answers.songs } };
    if (url.includes("/download")) {
      const id = Number(new URL(url).searchParams.get("id"));
      requests.downloads.push(id);
      const bytes = new TextEncoder().encode(answers.lrc.get(id) ?? "");
      return { content: btoa(String.fromCharCode(...bytes)) };
    }
    const hash = new URL(url).searchParams.get("hash");
    if (hash) return { candidates: [{ id: Number(hash), accesskey: "key" }] };
    return { candidates: answers.keyword };
  },
}));

import { kugouProvider } from "./kugou";

const NOTICE = "[00:01.58]纯音乐，请欣赏";
const VOCALS = "[00:10.00]First\n[00:20.00]Second";
const hit = (hash: number, duration: number) => ({ hash: String(hash), songname: "Song", singername: "Band", duration });
const lookup = () => kugouProvider.getLyrics("id", "Song", "Band", 200, null);

describe("KuGou lookup", () => {
  beforeEach(() => {
    requests.downloads.length = 0;
    answers.songs = [];
    answers.keyword = [];
    answers.lrc = new Map([
      [1, NOTICE],
      [2, VOCALS],
    ]);
  });

  it("stops at the instrumental notice, so a vocal version of the song can't answer for it", async () => {
    answers.songs = [hit(1, 200), hit(2, 180)];
    expect(await lookup()).toEqual([]);
    expect(requests.downloads).toEqual([1]);
  });

  it("reads a notice from the keyword search as no lyrics too", async () => {
    answers.keyword = [{ id: 1, accesskey: "key", song: "Song", singer: "Band", duration: 200_000 }];
    expect(await lookup()).toEqual([]);
  });

  it("still tries the next match when one has no lyrics at all", async () => {
    answers.lrc.delete(1);
    answers.songs = [hit(1, 200), hit(2, 180)];
    expect(await lookup()).toHaveLength(2);
    expect(requests.downloads).toEqual([1, 2]);
  });
});
