import { describe, expect, it } from "vitest";

import { nightlyHistory, readChangelogs, releaseHistory } from "./update-history.mjs";

const entry = (version, date, status = "RELEASE", items = [`${version} change`]) => ({
  version,
  date,
  status,
  sections: [{ title: "PLAYER", items }],
});

describe("releaseHistory", () => {
  const changelogs = [
    entry("0.1.0", "2026-07-16", "PRE-RELEASE"),
    entry("0.1.0-beta2", "2026-08-26"),
    entry("0.1.0-beta3", "2026-10-28"),
    entry("0.1.0-beta4", "2026-11-16"),
    entry("0.1.0-beta5", "2026-12-01"),
    entry("0.1.0-beta6", "2026-12-20", "PRE-RELEASE"),
  ];

  it("lists the release and the ones before it, newest first, by date", () => {
    expect(releaseHistory(changelogs, "0.1.0-beta5").map((item) => item.version)).toEqual([
      "0.1.0-beta5",
      "0.1.0-beta4",
      "0.1.0-beta3",
      "0.1.0-beta2",
    ]);
  });

  it("keeps to the limit and leaves later pre-releases out", () => {
    expect(releaseHistory(changelogs, "0.1.0-beta4", 2).map((item) => item.version)).toEqual(["0.1.0-beta4", "0.1.0-beta3"]);
  });

  it("refuses a version with no changelog", () => {
    expect(() => releaseHistory(changelogs, "0.2.0")).toThrow("no changelog for 0.2.0");
  });

  it("reads the real changelog folder", () => {
    const history = releaseHistory(readChangelogs("changelog"), "0.1.0-beta4");
    expect(history[0].version).toBe("0.1.0-beta4");
    expect(history[0].sections.some((section) => section.title === "ABOUT")).toBe(false);
  });
});

describe("nightlyHistory", () => {
  const pending = [
    { title: "PLAYER", items: ["Old change.", "New change."] },
    { title: "MUSIC", items: ["Music change."] },
  ];

  it("lists only bullets no earlier run had", () => {
    const previous = [{ run: 10, date: "2026-11-20", sections: [{ title: "PLAYER", items: ["Old change."] }] }];
    const history = nightlyHistory({ previous, pending, run: 11, date: "2026-11-21" });
    expect(history[0]).toEqual({
      run: 11,
      date: "2026-11-21",
      sections: [
        { title: "PLAYER", items: ["New change."] },
        { title: "MUSIC", items: ["Music change."] },
      ],
    });
    expect(history[1].run).toBe(10);
  });

  it("adds no group when nothing is new", () => {
    const previous = [{ run: 10, date: "2026-11-20", sections: pending }];
    expect(nightlyHistory({ previous, pending, run: 11, date: "2026-11-21" })).toEqual(previous);
  });

  it("starts from everything when there is no earlier history, and drops a stale re-run", () => {
    expect(nightlyHistory({ previous: undefined, pending, run: 5, date: "d" })[0].sections).toEqual(pending);
    const previous = [{ run: 12, date: "d", sections: pending }];
    expect(nightlyHistory({ previous, pending, run: 12, date: "d" })[0].run).toBe(12);
    expect(nightlyHistory({ previous, pending, run: 12, date: "d" })).toHaveLength(1);
  });

  it("keeps to the limit", () => {
    const previous = Array.from({ length: 5 }, (_, i) => ({ run: 10 - i, date: "d", sections: [{ title: "X", items: [`x${i}`] }] }));
    expect(nightlyHistory({ previous, pending, run: 11, date: "d", limit: 3 }).map((group) => group.run)).toEqual([11, 10, 9]);
  });
});
