import { describe, expect, it } from "vitest";

import { bugReportUrl, crashIssueUrl, parseCrashSummary } from "./crashReport";

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
    expect(url.origin + url.pathname).toBe("https://github.com/Flow-Tube/Flow-Desktop/issues/new");
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

describe("bugReportUrl", () => {
  it("opens the plain form off Linux", () => {
    expect(bugReportUrl(null)).toBe("https://github.com/Flow-Tube/Flow-Desktop/issues/new?template=bug_report.yml");
  });

  it("fills in the WebKitGTK version and the graphics line on Linux", () => {
    const url = new URL(
      bugReportUrl({
        tier: 1,
        tierReason: "nvidia-wayland",
        mode: "automatic",
        session: "wayland",
        x11Backend: false,
        packaging: "rpm",
        webkitgtk: "2.50.1",
        decoders: "system: H.264 absent, VP9 present",
      }),
    );
    expect(url.searchParams.get("webview")).toBe("WebKitGTK 2.50.1");
    expect(url.searchParams.get("graphics")).toBe(
      "Tier 1 (NVIDIA on Wayland), Automatic mode, wayland, rpm, WebKitGTK 2.50.1; system: H.264 absent, VP9 present",
    );
  });
});
