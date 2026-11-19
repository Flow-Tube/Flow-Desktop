import { describe, expect, it } from "vitest";
import { canPinWindows, formatGraphics, isSlowRenderPath, type GraphicsReport } from "./graphicsReport";

const report: GraphicsReport = {
  tier: 0,
  tierReason: "default",
  renderPath: "gpu",
  faster: "none",
  mode: "automatic",
  session: "x11",
  x11Backend: false,
  packaging: "appimage",
  webkitgtk: "2.48.3",
  decoders: "bundled: H.264 present, VP9 present, AV1 present, OpenH264 absent, VA present, NVDEC absent",
};

describe("formatGraphics", () => {
  it("names the tier, why, the session and the build", () => {
    expect(formatGraphics(report)).toBe("Tier 0 (default), GPU, Automatic mode, x11, appimage, WebKitGTK 2.48.3");
  });

  it("says when a Wayland session is drawn through X11", () => {
    expect(
      formatGraphics({ ...report, tier: 3, tierReason: "settings", renderPath: "software", mode: "safe", session: "wayland", x11Backend: true }),
    ).toBe("Tier 3 (from Graphics compatibility in Settings), no GPU, Safe mode, wayland drawn through X11, appimage, WebKitGTK 2.48.3");
  });

  it("keeps a reason it does not know rather than hiding it", () => {
    expect(formatGraphics({ ...report, tierReason: "new-rule", session: "" })).toContain("Tier 0 (new-rule), GPU, Automatic mode, unknown session");
  });

  it("names the slower paths and where a remembered tier came from", () => {
    expect(formatGraphics({ ...report, tier: 1, tierReason: "trial-kept", renderPath: "shared-memory" })).toContain(
      "Tier 1 (kept after a faster graphics trial), GPU through shared memory,",
    );
    expect(formatGraphics({ ...report, tier: 2, tierReason: "crash-loop", renderPath: "software" })).toContain(
      "Tier 2 (after the page kept crashing), no GPU,",
    );
  });
});

describe("a launch on the user's own variables", () => {
  const own = { ...report, tierReason: "own-variables", renderPath: "own-variables" };

  it("says so in place of a path Flow did not choose", () => {
    expect(formatGraphics(own)).toBe(
      "Tier 0 (started with your own variables), path set by your WebKitGTK variables, Automatic mode, x11, appimage, WebKitGTK 2.48.3",
    );
  });

  it("counts as a slow path, since Flow can't tell", () => {
    expect(isSlowRenderPath(own)).toBe(true);
  });
});

describe("isSlowRenderPath", () => {
  it("is false off Linux and on the GPU path", () => {
    expect(isSlowRenderPath(null)).toBe(false);
    expect(isSlowRenderPath(report)).toBe(false);
  });

  it("is true where frames are copied or drawn without the GPU", () => {
    expect(isSlowRenderPath({ ...report, renderPath: "shared-memory" })).toBe(true);
    expect(isSlowRenderPath({ ...report, renderPath: "software" })).toBe(true);
  });
});

describe("canPinWindows", () => {
  it("allows pinning off Linux and on X11", () => {
    expect(canPinWindows(null)).toBe(true);
    expect(canPinWindows({ ...report, session: "x11" })).toBe(true);
  });

  it("allows pinning when Wayland is drawn through X11", () => {
    expect(canPinWindows({ ...report, session: "wayland", x11Backend: true })).toBe(true);
  });

  it("hides pinning on native Wayland", () => {
    expect(canPinWindows({ ...report, session: "wayland", x11Backend: false })).toBe(false);
  });
});
