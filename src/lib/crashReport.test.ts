import { describe, expect, it } from "vitest";

import { crashIssueUrl, parseCrashSummary } from "./crashReport";

const REPORT = [
  "Flow crash report",
  "Version: 0.1.0-beta4",
  "OS: macos aarch64",
  "Time: 2026-11-06T10:00:00+00:00",
  "Thread: tokio-runtime-worker",
  "Message: index out of bounds",
  "Where: src/lib.rs:1:2",
  "",
  "Backtrace:",
  "   0: flow::run",
].join("\n");

describe("crash report", () => {
  it("reads the summary lines", () => {
    expect(parseCrashSummary(REPORT)).toEqual({
      version: "0.1.0-beta4",
      os: "macos aarch64",
      time: "2026-11-06T10:00:00+00:00",
      message: "index out of bounds",
      where: "src/lib.rs:1:2",
    });
  });

  it("leaves out lines a report doesn't have", () => {
    expect(parseCrashSummary("Flow crash report\nMessage: \n").message).toBeNull();
  });

  it("fills in the bug form", () => {
    const url = new URL(crashIssueUrl(REPORT));
    expect(url.origin + url.pathname).toBe("https://github.com/FlowNeuro/Flow-Desktop/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("title")).toBe("[Bug]: index out of bounds in src/lib.rs:1:2");
    expect(url.searchParams.get("app-version")).toBe("0.1.0-beta4");
    expect(url.searchParams.get("logs")).toContain("flow::run");
  });

  it("keeps the link short enough to open however long the report is", () => {
    const long = `${REPORT}\nMessage: ${"x".repeat(5000)}\n${"frame\n".repeat(5000)}`;
    expect(crashIssueUrl(long).length).toBeLessThan(4000);
  });
});
