import { describe, expect, it } from "vitest";

import { parseUnison } from "./unison";

const body = (lyrics: string, format: string, syncType: string, success = true) =>
  `{"success":${success},"data":{"lyrics":"${lyrics}","format":"${format}","syncType":"${syncType}","id":7}}`;

describe("Unison", () => {
  it("turns line-synced LRC into timed lines", () => {
    const entries = parseUnison(body("[00:01.00]First\\n[00:12.50]Second", "lrc", "linesync"));
    expect(entries.map((e) => [e.time, e.text])).toEqual([
      [1000, "First"],
      [12500, "Second"],
    ]);
  });

  it("turns word stamps in LRC into word timings", () => {
    const entries = parseUnison(body("[00:01.00]<00:01.00>Hello <00:01.50>there", "lrc", "wordsync"));
    expect(entries[0]?.words?.map((w) => w.text)).toEqual(["Hello", "there"]);
  });

  it("keeps plain text as one unsynced entry", () => {
    const entries = parseUnison(body("First\\nSecond", "lrc", "plain"));
    expect(entries).toEqual([{ time: 0, text: "First\nSecond" }]);
  });

  it("gives nothing for an unsuccessful answer", () => {
    expect(parseUnison(body("[00:01.00]First", "lrc", "linesync", false))).toEqual([]);
    expect(parseUnison('{"success":false,"error":"Lyrics not found","code":"NOT_FOUND"}')).toEqual([]);
  });
});
