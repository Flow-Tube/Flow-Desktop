import { describe, expect, it } from "vitest";
import type { GraphicsReport } from "./graphicsReport";
import { noticeKey, shouldShowSlowGraphicsNotice } from "./graphicsTrial";

const report: GraphicsReport = {
  tier: 1,
  tierReason: "failed-launches",
  renderPath: "shared-memory",
  faster: "suggested",
  mode: "automatic",
  session: "wayland",
  x11Backend: false,
  packaging: "rpm",
  webkitgtk: "2.54.2",
  decoders: null,
};

describe("shouldShowSlowGraphicsNotice", () => {
  it("stays quiet off Linux and on a tier nothing can lift", () => {
    expect(shouldShowSlowGraphicsNotice(null, null)).toBe(false);
    expect(shouldShowSlowGraphicsNotice({ ...report, faster: "available" }, null)).toBe(false);
  });

  it("shows once for a tier on a WebKitGTK version", () => {
    expect(shouldShowSlowGraphicsNotice(report, null)).toBe(true);
    expect(shouldShowSlowGraphicsNotice(report, noticeKey(report))).toBe(false);
  });

  it("shows again when the tier or WebKitGTK changes", () => {
    const seen = noticeKey(report);
    expect(shouldShowSlowGraphicsNotice({ ...report, tier: 2 }, seen)).toBe(true);
    expect(shouldShowSlowGraphicsNotice({ ...report, webkitgtk: "2.56.0" }, seen)).toBe(true);
  });
});
