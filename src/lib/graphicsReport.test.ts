import { describe, expect, it } from "vitest";
import { formatGraphics, type GraphicsReport } from "./graphicsReport";

const report: GraphicsReport = {
  tier: 0,
  tierReason: "default",
  mode: "automatic",
  session: "x11",
  x11Backend: false,
  packaging: "appimage",
  webkitgtk: "2.48.3",
  decoders: "bundled: H.264 present, VP9 present, AV1 present, OpenH264 absent, VA present, NVDEC absent",
};

describe("formatGraphics", () => {
  it("names the tier, why, the session and the build", () => {
    expect(formatGraphics(report)).toBe("Tier 0 (default), Automatic mode, x11, appimage, WebKitGTK 2.48.3");
  });

  it("says when a Wayland session is drawn through X11", () => {
    expect(
      formatGraphics({ ...report, tier: 3, tierReason: "settings", mode: "safe", session: "wayland", x11Backend: true }),
    ).toBe("Tier 3 (from Graphics compatibility in Settings), Safe mode, wayland drawn through X11, appimage, WebKitGTK 2.48.3");
  });

  it("keeps a reason it does not know rather than hiding it", () => {
    expect(formatGraphics({ ...report, tierReason: "new-rule", session: "" })).toContain("Tier 0 (new-rule), Automatic mode, unknown session");
  });
});
