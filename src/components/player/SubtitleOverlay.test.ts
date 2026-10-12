import { describe, expect, it } from "vitest";
import { parseCaptionCues } from "./SubtitleOverlay";

const vtt = (...cueLines: string[]) => `WEBVTT

00:00:01.000 --> 00:00:03.000
${cueLines.join("\n")}
`;

describe("parseCaptionCues (WebVTT)", () => {
  it("decodes every HTML entity in a cue", () => {
    const [cue] = parseCaptionCues(vtt("Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;hi&quot; it&#39;s&#x21;&lrm;"), false);

    expect(cue?.text).toBe(`Tom & Jerry <3 "hi" it's!\u200E`);
  });

  it("drops styling tags but keeps escaped angle brackets as text", () => {
    const [cue] = parseCaptionCues(vtt("<c.colorE5E5E5>so</c> <i>this</i> &lt;i&gt;"), false);

    expect(cue?.text).toBe("so this <i>");
  });

  it("keeps each cue and its timing separate", () => {
    const cues = parseCaptionCues(
      `WEBVTT

00:00:01.000 --> 00:00:02.000
one&nbsp;

00:00:02.000 --> 00:00:03.500 align:start position:0%
<00:00:02.200><c> two</c>&nbsp;&amp; three
`,
      false,
    );

    expect(cues).toEqual([
      { start: 1, end: 2, text: "one" },
      {
        start: 2,
        end: 3.5,
        text: "two & three",
        align: "start",
        words: [
          { start: 2, text: "" },
          { start: 2.2, text: " two & three" },
        ],
      },
    ]);
  });

  it("keeps a stray unescaped < as text without losing the next cue", () => {
    const cues = parseCaptionCues(
      `WEBVTT

00:00:01.000 --> 00:00:02.000
a <b c

00:00:02.000 --> 00:00:03.000
next
`,
      false,
    );

    expect(cues).toEqual([
      { start: 1, end: 2, text: "a <b c" },
      { start: 2, end: 3, text: "next" },
    ]);
  });

  it("keeps every line of the cue and its line breaks", () => {
    const [cue] = parseCaptionCues(vtt("♪ CRYSTAL BALLIN, JUST TO", "HELP HIM SEE WHAT HE'S BEEN", "MISSING ♪"), false);

    expect(cue?.text).toBe("♪ CRYSTAL BALLIN, JUST TO\nHELP HIM SEE WHAT HE'S BEEN\nMISSING ♪");
  });

  it("reads a file with Windows line endings", () => {
    const cues = parseCaptionCues(vtt("<c>one</c>&nbsp;", "two").replace(/\n/g, "\r\n"), false);

    expect(cues).toEqual([{ start: 1, end: 3, text: "one\ntwo" }]);
  });
});

describe("parseCaptionCues (auto-generated WebVTT)", () => {
  // As YouTube sends them: each line rolls up above the next, with a 10ms cue holding it in between.
  const rollUp = `WEBVTT
Kind: captions
Language: en

00:00:26.480 --> 00:00:28.630 align:start position:0%
uh, all of the other rational and
irrational<00:00:26.960><c> numbers</c><00:00:27.279><c> together.</c><00:00:28.159><c> Um,</c>

00:00:28.630 --> 00:00:28.640 align:start position:0%
irrational numbers together. Um,


00:00:28.640 --> 00:00:31.909 align:start position:0%
irrational numbers together. Um,
including<00:00:29.039><c> things</c><00:00:29.279><c> like</c><00:00:29.520><c> pi</c>
`;

  it("shows the previous line above the one being spoken, without the hold cue in between", () => {
    const cues = parseCaptionCues(rollUp, true);

    expect(cues.map((cue) => cue.text)).toEqual([
      "uh, all of the other rational and\nirrational numbers together. Um,",
      "irrational numbers together. Um,\nincluding things like pi",
    ]);
    expect(cues[0]?.end).toBeCloseTo(28.64);
    expect(cues[1]?.start).toBeCloseTo(28.64);
  });

  it("lines the rolling lines up on the left, as their cues ask", () => {
    expect(parseCaptionCues(rollUp, true).map((cue) => cue.align)).toEqual(["start", "start"]);
  });

  it("keeps when each word of the line being spoken comes in", () => {
    expect(parseCaptionCues(rollUp, true)[1]?.words).toEqual([
      { start: 28.64, text: "including" },
      { start: 29.039, text: " things" },
      { start: 29.279, text: " like" },
      { start: 29.52, text: " pi" },
    ]);
  });
});
