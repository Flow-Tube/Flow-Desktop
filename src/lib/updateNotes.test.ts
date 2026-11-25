import { describe, expect, it } from "vitest";

import { nightlyRun, notesSinceInstalled } from "./updateNotes";

const release = (version: string, date: string, item = `${version} change`) => ({
  version,
  date,
  sections: [{ title: "PLAYER", items: [item] }],
});

const releases = [
  release("0.1.0-beta6", "2026-12-20"),
  release("0.1.0-beta5", "2026-12-01"),
  release("0.1.0-beta4", "2026-11-16"),
  release("0.1.0-beta3", "2026-10-28"),
];

describe("notesSinceInstalled, releases", () => {
  it("lists every release after the installed one, newest first", () => {
    const notes = notesSinceInstalled(releases, { version: "0.1.0-beta4", date: "2026-11-16" }, "0.1.0-beta6");
    expect(notes?.releases.map((item) => item.version)).toEqual(["0.1.0-beta6", "0.1.0-beta5"]);
    expect(notes?.sinceRun).toBeNull();
  });

  it("orders by date, so the July 0.1.0 is older than every beta", () => {
    const history = [release("0.1.0-beta2", "2026-08-26"), release("0.1.0", "2026-07-16")];
    const notes = notesSinceInstalled(history, { version: "0.1.0", date: "2026-07-16" }, "0.1.0-beta2");
    expect(notes?.releases.map((item) => item.version)).toEqual(["0.1.0-beta2"]);
  });

  it("falls back to the version when the installed build has no dated changelog", () => {
    const notes = notesSinceInstalled(releases, { version: "0.1.0-beta5", date: null }, "0.1.0-beta6");
    expect(notes?.releases.map((item) => item.version)).toEqual(["0.1.0-beta6"]);
  });

  it("gives nothing without a usable history", () => {
    expect(notesSinceInstalled(undefined, { version: "0.1.0-beta4", date: null }, "0.1.0-beta5")).toBeNull();
    expect(notesSinceInstalled([{ version: 5 }], { version: "0.1.0-beta4", date: null }, "0.1.0-beta5")).toBeNull();
    expect(notesSinceInstalled(releases, { version: "0.1.0-beta6", date: "2026-12-20" }, "0.1.0-beta6")).toBeNull();
  });
});

describe("notesSinceInstalled, nightlies", () => {
  const runs = [
    { run: 1760, date: "2026-11-25", sections: [{ title: "PLAYER", items: ["c"] }, { title: "MUSIC", items: ["m"] }] },
    { run: 1755, date: "2026-11-23", sections: [{ title: "PLAYER", items: ["b"] }] },
    { run: 1750, date: "2026-11-20", sections: [{ title: "PLAYER", items: ["a"] }] },
  ];

  it("merges only the runs after the installed one, oldest change first", () => {
    const notes = notesSinceInstalled(runs, { version: "0.1.0-nightly.1752", date: null }, "0.1.0-nightly.1760");
    expect(notes).toEqual({
      releases: [{
        version: "0.1.0-nightly.1760",
        date: "2026-11-25",
        sections: [{ title: "PLAYER", items: ["b", "c"] }, { title: "MUSIC", items: ["m"] }],
      }],
      sinceRun: 1752,
    });
  });

  it("reads Linux's +nightly versions", () => {
    expect(nightlyRun("0.1.0+nightly.1760")).toBe(1760);
    const notes = notesSinceInstalled(runs, { version: "0.1.0+nightly.1759", date: null }, "0.1.0+nightly.1760");
    expect(notes?.releases[0]?.sections).toEqual([{ title: "PLAYER", items: ["c"] }, { title: "MUSIC", items: ["m"] }]);
  });

  it("gives nothing when no run is newer", () => {
    expect(notesSinceInstalled(runs, { version: "0.1.0-nightly.1760", date: null }, "0.1.0-nightly.1760")).toBeNull();
  });
});
