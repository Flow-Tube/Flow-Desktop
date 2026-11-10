import { describe, expect, it } from "vitest";

import { parseFlowUrl } from "./flowHandoff";

const open = (link: string) => parseFlowUrl(`flow://open?url=${encodeURIComponent(link)}`);
const VIDEO = "dQw4w9WgXcQ";

describe("flow://open", () => {
  it("opens a video", () => {
    expect(open(`https://www.youtube.com/watch?v=${VIDEO}`)).toEqual({ action: "watch", v: VIDEO, list: undefined });
    expect(open(`https://youtu.be/${VIDEO}`)).toEqual({ action: "watch", v: VIDEO, list: undefined });
  });

  it("plays a video in the playlist its link names", () => {
    expect(open(`https://www.youtube.com/watch?v=${VIDEO}&list=PLabcdefghij`)).toEqual({ action: "watch", v: VIDEO, list: "PLabcdefghij" });
  });

  it("plays a video alone from a mix or an account's own list", () => {
    for (const list of ["RDdQw4w9WgXcQ", "RDAMVMdQw4w9WgXcQ", "LL", "WL", "LM"]) {
      expect(open(`https://www.youtube.com/watch?v=${VIDEO}&list=${list}`)).toEqual({ action: "watch", v: VIDEO, list: undefined });
    }
  });

  it("keeps a community radio list, which isn't a mix", () => {
    expect(open(`https://www.youtube.com/watch?v=${VIDEO}&list=RDCLAK5uy_abcdef`)?.action).toBe("watch");
    expect(open(`https://www.youtube.com/watch?v=${VIDEO}&list=RDCLAK5uy_abcdef`)).toMatchObject({ list: "RDCLAK5uy_abcdef" });
  });

  it("sends a song to the music player, with its list", () => {
    expect(open(`https://music.youtube.com/watch?v=${VIDEO}&list=RDAMVMabc`)).toEqual({ action: "music", v: VIDEO, list: "RDAMVMabc" });
    expect(open(`https://music.youtube.com/watch?v=${VIDEO}&list=LM`)).toEqual({ action: "music", v: VIDEO, list: undefined });
  });

  it("opens a Short in the Shorts player", () => {
    expect(open(`https://www.youtube.com/shorts/${VIDEO}`)).toEqual({ action: "page", route: `/shorts/${VIDEO}` });
  });

  it("opens playlists, albums, channels and artists on their own pages", () => {
    expect(open("https://www.youtube.com/playlist?list=PLabcdefghij")).toEqual({ action: "page", route: "/playlist/PLabcdefghij" });
    expect(open("https://music.youtube.com/playlist?list=PLabcdefghij")).toEqual({ action: "page", route: "/music/playlist/PLabcdefghij" });
    expect(open("https://www.youtube.com/playlist?list=OLAK5uy_abcdef")).toEqual({ action: "page", route: "/music/playlist/OLAK5uy_abcdef" });
    expect(open("https://music.youtube.com/browse/MPREb_abcdef")).toEqual({ action: "page", route: "/music/album/MPREb_abcdef" });
    expect(open("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({ action: "page", route: "/channel/UCabcdefghijklmnopqrstuv" });
    expect(open("https://music.youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({ action: "page", route: "/music/artist/UCabcdefghijklmnopqrstuv" });
  });

  it("has the backend resolve a handle", () => {
    expect(open("https://www.youtube.com/@flow")).toEqual({ action: "channel", url: "https://www.youtube.com/@flow", music: false });
  });

  it("opens the account's own lists locally, and has no page for a mix", () => {
    expect(open("https://www.youtube.com/playlist?list=LL")).toEqual({ action: "page", route: "/liked" });
    expect(open("https://www.youtube.com/playlist?list=WL")).toEqual({ action: "page", route: "/watch-later" });
    expect(open("https://music.youtube.com/playlist?list=LM")).toEqual({ action: "page", route: "/liked" });
    expect(open("https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ")).toBeNull();
  });

  it("reads the same links from nocookie, piped.video and yewtu.be", () => {
    expect(open(`https://www.youtube-nocookie.com/embed/${VIDEO}`)).toMatchObject({ action: "watch", v: VIDEO });
    expect(open(`https://piped.video/watch?v=${VIDEO}`)).toMatchObject({ action: "watch", v: VIDEO });
    expect(open(`https://yewtu.be/watch?v=${VIDEO}&list=PLabcdefghij`)).toMatchObject({ action: "watch", list: "PLabcdefghij" });
    expect(open(`https://yewtu.be/shorts/${VIDEO}`)).toEqual({ action: "page", route: `/shorts/${VIDEO}` });
  });

  it("never guesses a channel from a front-end's bare path", () => {
    expect(open("https://piped.video/trending")).toBeNull();
    expect(open("https://yewtu.be/somename")).toBeNull();
    expect(open("https://www.youtube.com/trending")).toBeNull();
  });

  it("refuses anything that isn't a web link to these hosts", () => {
    for (const link of [
      "",
      "javascript:alert(1)",
      "file:///etc/passwd",
      `www.youtube.com/watch?v=${VIDEO}`,
      `https://evil.example/watch?v=${VIDEO}`,
      `https://youtube.com.evil.example/watch?v=${VIDEO}`,
      `https://www.youtube.com@evil.example/watch?v=${VIDEO}`,
      `https://notyoutube.com/watch?v=${VIDEO}`,
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/%E0%A4%A",
      `https://www.youtube.com/watch?v=${VIDEO}&a=${"x".repeat(2100)}`,
    ]) {
      expect(open(link), link).toBeNull();
    }
    expect(parseFlowUrl("flow://open")).toBeNull();
    expect(parseFlowUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseFlowUrl("flow://settings?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseFlowUrl("not a url")).toBeNull();
  });
});

describe("the older verbs", () => {
  it("still read a video, a position and a list", () => {
    expect(parseFlowUrl(`flow://watch?v=${VIDEO}&t=42&list=PLabcdefghij`)).toEqual({ action: "watch", v: VIDEO, t: 42, list: "PLabcdefghij" });
    expect(parseFlowUrl(`flow:///watch?v=${VIDEO}`)).toMatchObject({ action: "watch", v: VIDEO });
    expect(parseFlowUrl(`flow://music?v=${VIDEO}`)).toEqual({ action: "music", v: VIDEO });
    expect(parseFlowUrl(`flow://download?v=${VIDEO}`)).toEqual({ action: "download", v: VIDEO });
    expect(parseFlowUrl(`flow://music-download?v=${VIDEO}`)).toEqual({ action: "music-download", v: VIDEO });
  });

  it("skip a mix or an unreadable list on a watch link", () => {
    expect(parseFlowUrl(`flow://watch?v=${VIDEO}&list=RDdQw4w9WgXcQ`)).toMatchObject({ list: undefined });
    expect(parseFlowUrl(`flow://watch?v=${VIDEO}&list=bad!list`)).toMatchObject({ list: undefined });
    expect(parseFlowUrl(`flow://watch?v=${VIDEO}&t=abc`)).toMatchObject({ t: undefined });
    expect(parseFlowUrl("flow://watch?v=bad")).toBeNull();
  });
});
