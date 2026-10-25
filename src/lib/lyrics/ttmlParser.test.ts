import { describe, expect, it } from "vitest";

import { parseTTMLToLyricsEntries } from "./ttmlParser";

const doc = (body: string) =>
  `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>${body}</div></body></tt>`;

const lines = (...times: Array<[string, string]>) =>
  doc(times.map(([begin, end]) => `<p begin="${begin}" end="${end}"><span begin="${begin}" end="${end}">Word</span></p>`).join(""));

describe("TTML parser", () => {
  it("reads Apple-style bare seconds and minute times", () => {
    const entries = parseTTMLToLyricsEntries(lines(["27.395", "28.100"], ["1:02.345", "1:03.000"], ["3:12.818", "3:14.043"]));
    expect(entries.map((e) => e.time)).toEqual([27395, 62345, 192818]);
    expect(entries[0]?.words?.[0]?.endTime).toBe(28100);
  });

  it("still reads offset and clock times", () => {
    const entries = parseTTMLToLyricsEntries(lines(["9.446s", "10s"], ["12500ms", "13000ms"], ["00:01:02.5", "00:01:03.25"]));
    expect(entries.map((e) => e.time)).toEqual([9446, 12500, 62500]);
    expect(entries[2]?.words?.[0]?.endTime).toBe(63250);
  });

  it("skips a paragraph that holds only a background span, keeping the background line", () => {
    const entries = parseTTMLToLyricsEntries(
      doc(
        `<p begin="1.0" end="3.0"><span begin="1.0" end="2.0">Main</span></p>` +
          `<p begin="5.0" end="6.0"><span ttm:role="x-bg" begin="5.0" end="6.0"><span begin="5.0" end="6.0">(ooh)</span></span></p>`,
      ),
    );
    expect(entries.map((e) => [e.text, !!e.isBackground])).toEqual([
      ["Main", false],
      ["(ooh)", true],
    ]);
  });

  it("keeps romanization in its own field, apart from the translation", () => {
    const entries = parseTTMLToLyricsEntries(
      doc(
        `<p begin="1.0" end="3.0"><span begin="1.0" end="2.0">愛してる</span>` +
          `<span ttm:role="x-translation">I love you</span><span ttm:role="x-roman">aishiteru</span><span ttm:role="x-roman"> </span></p>`,
      ),
    );
    expect(entries[0]?.translation).toBe("I love you");
    expect(entries[0]?.romanization).toBe("aishiteru");
    expect(entries[0]?.text).toBe("愛してる");
  });
});
