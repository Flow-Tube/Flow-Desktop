import { describe, expect, it } from "vitest";
import { hoverPreviewMode } from "./hoverPreviewMode";
import { SETTINGS } from "./settings/schema";

describe("hoverPreviewMode", () => {
  it("is off until chosen", () => {
    expect(hoverPreviewMode({})).toBe("off");
  });

  it("keeps a choice", () => {
    expect(hoverPreviewMode({ [SETTINGS.VIDEO_HOVER_PREVIEW_MODE]: "video" })).toBe("video");
    expect(hoverPreviewMode({ [SETTINGS.VIDEO_HOVER_PREVIEW_MODE]: "off", video_hover_previews_enabled: "true" })).toBe("off");
  });

  it("reads the switch it replaced: on means Frames", () => {
    expect(hoverPreviewMode({ video_hover_previews_enabled: "true" })).toBe("frames");
    expect(hoverPreviewMode({ video_hover_previews_enabled: "false" })).toBe("off");
  });
});
