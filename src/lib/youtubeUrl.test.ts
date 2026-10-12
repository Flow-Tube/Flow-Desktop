import { describe, expect, it } from "vitest";
import {
  youtubeMusicAlbumUrl,
  youtubeMusicWatchUrl,
  youtubePlaylistUrl,
  youtubePostUrl,
  youtubeShortsUrl,
  youtubeWatchUrl,
} from "./youtubeUrl";

describe("youtubeWatchUrl", () => {
  it("links to the video on YouTube", () => {
    expect(youtubeWatchUrl("vN44jvYD0aY")).toBe("https://www.youtube.com/watch?v=vN44jvYD0aY");
  });

  it("starts at the given second, rounded down", () => {
    expect(youtubeWatchUrl("vN44jvYD0aY", 83.9)).toBe("https://www.youtube.com/watch?v=vN44jvYD0aY&t=83s");
    expect(youtubeWatchUrl("vN44jvYD0aY", 0)).toBe("https://www.youtube.com/watch?v=vN44jvYD0aY&t=0s");
  });
});

describe("youtubeShortsUrl", () => {
  it("links to the short on YouTube", () => {
    expect(youtubeShortsUrl("abcdefghijk")).toBe("https://www.youtube.com/shorts/abcdefghijk");
  });
});

describe("YouTube Music, playlist and post links", () => {
  it("links to each on YouTube", () => {
    expect(youtubeMusicWatchUrl("abcdefghijk")).toBe("https://music.youtube.com/watch?v=abcdefghijk");
    expect(youtubeMusicAlbumUrl("MPREb_abc")).toBe("https://music.youtube.com/browse/MPREb_abc");
    expect(youtubePlaylistUrl("PLabc")).toBe("https://www.youtube.com/playlist?list=PLabc");
    expect(youtubePostUrl("Ugkxabc")).toBe("https://www.youtube.com/post/Ugkxabc");
  });
});
