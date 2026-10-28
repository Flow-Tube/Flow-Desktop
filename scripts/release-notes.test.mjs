import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_MESSAGE, releaseNotes } from "./release-notes.mjs";

const CHANGELOG = [
  "﻿FLOW DESKTOP CHANGE LOG",
  "VERSION: 0.2.0",
  "DATE: 2026-11-01",
  "STATUS: PRE-RELEASE",
  "",
  "ABOUT",
  "Flow Desktop is a privacy-first client.",
  "",
  "",
  "MACOS",
  "- Fixed the dock icon.",
  "",
  "TABS AND WINDOWS:",
  "- Tabs live in the side rail.",
  "",
  "",
].join("\r\n");

function changelogDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "flow-changelog-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("releaseNotes", () => {
  it("renders the GitHub body with a title, details, the support message and headings", () => {
    const dir = changelogDir({ "v0.2.0.txt": CHANGELOG });
    expect(releaseNotes("v0.2.0", { changelogDir: dir })).toBe(
      [
        "# Flow v0.2.0",
        "",
        "**Release date:** 2026-11-01",
        "**Status:** Pre-release",
        "",
        SUPPORT_MESSAGE,
        "",
        "## About",
        "",
        "Flow Desktop is a privacy-first client.",
        "",
        "## macOS",
        "",
        "- Fixed the dock icon.",
        "",
        "## Tabs and windows",
        "",
        "- Tabs live in the side rail.",
      ].join("\n"),
    );
  });

  it("renders plain-text app notes without the title, metadata or support message", () => {
    const dir = changelogDir({ "v0.2.0.txt": CHANGELOG });
    expect(releaseNotes("v0.2.0", { app: true, changelogDir: dir })).toBe(
      [
        "ABOUT",
        "Flow Desktop is a privacy-first client.",
        "",
        "MACOS",
        "- Fixed the dock icon.",
        "",
        "TABS AND WINDOWS",
        "- Tabs live in the side rail.",
      ].join("\n"),
    );
  });

  it("fails instead of using another release's changelog", () => {
    const dir = changelogDir({ "v0.1.0.txt": "VERSION: 0.1.0\n" });
    expect(() => releaseNotes("v0.1.0-beta", { changelogDir: dir })).toThrow(/No changelog/);
  });

  it("fails when the file's VERSION does not match the tag", () => {
    const dir = changelogDir({ "v0.2.0.txt": "VERSION: 0.1.9\nNOTES\n- x\n" });
    expect(() => releaseNotes("v0.2.0", { changelogDir: dir })).toThrow(/VERSION: 0.1.9/);
  });

  it("rejects a tag that is not a version", () => {
    expect(() => releaseNotes("nightly")).toThrow(/Invalid release tag/);
  });
});
