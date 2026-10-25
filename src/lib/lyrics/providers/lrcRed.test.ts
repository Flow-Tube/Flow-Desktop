import { describe, expect, it } from "vitest";

import { parseLrcRedSearch, pickLrcRedHit } from "./lrcRed";

const hit = ({
  title = "Song",
  artist = "Band",
  duration = 200,
  timing = "word",
  url = "https://lrc.red/s/XX0000000001.ttml",
} = {}) =>
  `{"track_name":"${title}","artist_name":"${artist}","duration":${duration},"timing_type":"${timing}","lyricsUrl":"${url}","isrc":"XX0000000001"}`;

const hits = (...items: string[]) => parseLrcRedSearch(`{"results":[${items.join(",")}],"extra":1}`);
const song = (title: string) => ({ title, artist: "Band", durationSec: 200 });

describe("lrc.red", () => {
  it("parses search results and ignores unknown fields", () => {
    const parsed = hits(hit());
    expect(parsed[0]?.track_name).toBe("Song");
    expect(parsed[0]?.lyricsUrl).toBe("https://lrc.red/s/XX0000000001.ttml");
  });

  it("prefers a word-timed file over a line-timed one of the same recording", () => {
    const picked = pickLrcRedHit(hits(hit({ timing: "line" }), hit({ timing: "word", duration: 201 })), song("Song"));
    expect(picked?.timing_type).toBe("word");
  });

  it("does not take the studio cut for a live request", () => {
    expect(pickLrcRedHit(hits(hit()), song("Song (Live)"))).toBeNull();
  });

  it("never fetches a document that is not served over https", () => {
    expect(pickLrcRedHit(hits(hit({ url: "http://lrc.red/s/a.ttml" })), song("Song"))).toBeNull();
  });
});
