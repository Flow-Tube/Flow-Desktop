import { describe, expect, it } from "vitest";
import { findMoments, insertMoment, noteRichText, timeline } from "./noteMoments";

describe("findMoments", () => {
  it("reads times as Android does, with the words after them", () => {
    const moments = findMoments("Intro 0:15 - the start\n1:02:03 end part\nnothing here");
    expect(moments.map((m) => m.seconds)).toEqual([15, 3723]);
    expect(moments[0]?.label).toBe("the start");
    expect(moments[1]?.label).toBe("end part");
  });

  it("marks exactly the characters of the time", () => {
    const [moment] = findMoments("see 12:34 ok");
    expect("see 12:34 ok".slice(moment?.start, moment?.end)).toBe("12:34");
  });

  it("stops a label at the next time on the line", () => {
    expect(findMoments("1:00 first 2:00 second")[0]?.label).toBe("first");
  });

  it("leaves out what isn't a time", () => {
    expect(findMoments("1:60 and 1:61:00 and 1.2:30 and 12:345 and 1:23:45:6")).toEqual([]);
  });

  it("leaves out times past the end of the video", () => {
    expect(findMoments("0:30 and 5:00", 60).map((m) => m.seconds)).toEqual([30]);
    expect(findMoments("5:00", 0).map((m) => m.seconds)).toEqual([300]);
  });
});

describe("timeline", () => {
  it("has one entry per time, earliest first", () => {
    expect(timeline("5:00 b\n1:00 a\n5:00 again").map((m) => m.seconds)).toEqual([60, 300]);
  });
});

describe("insertMoment", () => {
  it("writes the time at an empty start", () => {
    expect(insertMoment("", 0, 754)).toEqual({ text: "12:34 ", cursor: 6 });
  });

  it("starts a new line unless the cursor already starts one", () => {
    expect(insertMoment("abc", 3, 5)).toEqual({ text: "abc\n0:05 ", cursor: 9 });
    expect(insertMoment("abc\n", 4, 5)).toEqual({ text: "abc\n0:05 ", cursor: 9 });
  });

  it("keeps the text after the cursor and clamps the cursor", () => {
    expect(insertMoment("ab", 1, 5).text).toBe("a\n0:05 b");
    expect(insertMoment("ab", 99, 5).text).toBe("ab\n0:05 ");
  });

  it("writes hours when the time has them", () => {
    expect(insertMoment("", 0, 3723).text).toBe("1:02:03 ");
  });
});

describe("noteRichText", () => {
  it("links each time to its place in the video", () => {
    const rich = noteRichText("go to 1:00 now");
    expect(rich.spans).toEqual([{ start: 6, length: 4, target: { kind: "timestamp", seconds: 60 } }]);
  });
});
