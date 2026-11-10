import { describe, expect, it } from "vitest";

import { loadChangelog, releaseFromText, sortReleases, type ChangelogRelease } from "./changelog";

const TEXT = ["FLOW DESKTOP CHANGE LOG", "VERSION: 0.2.0", "DATE: 2026-11-01", "STATUS: RELEASE", "", "ABOUT", "A client.", "", "MUSIC", "- Faster.", "- Better.", "", "FIXES", "- Fixed it."].join("\n");

const release = (version: string, date: string | null): ChangelogRelease => ({ version, date, sections: [] });

describe("changelog", () => {
  it("reads a release's version, date and sections, without its About text", () => {
    expect(releaseFromText("../v0.2.0.txt", TEXT)).toEqual({
      version: "0.2.0",
      date: "2026-11-01",
      sections: [
        { title: "MUSIC", items: ["Faster.", "Better."] },
        { title: "FIXES", items: ["Fixed it."] },
      ],
    });
  });

  it("falls back to the file's name for the version", () => {
    expect(releaseFromText("../../changelog/v0.3.0-beta1.txt", "MUSIC\n- Faster.").version).toBe("0.3.0-beta1");
  });

  it("puts the newest first", () => {
    const sorted = sortReleases([release("0.1.0", "2026-07-16"), release("0.1.0-beta4", "2026-10-28"), release("0.1.0-beta10", "2026-10-28")]);
    expect(sorted.map((item) => item.version)).toEqual(["0.1.0-beta10", "0.1.0-beta4", "0.1.0"]);
  });

  it("bundles the real changelog files", async () => {
    const releases = await loadChangelog();
    expect(releases.length).toBeGreaterThanOrEqual(4);
    expect(releases.map((item) => item.version)).toContain("0.1.0-beta3");
    expect(releases.every((item) => item.sections.length > 0)).toBe(true);
  });
});
