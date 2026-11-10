import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VideoThumbnailPreview } from "./VideoThumbnailPreview";
import type { StoryboardFrame } from "../../lib/seekPreview";
import type { StoryboardLevel } from "../../types/video";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockLevel: StoryboardLevel = {
  width: 160,
  height: 90,
  count: 100,
  columns: 5,
  rows: 5,
  intervalMs: 1000,
  urlTemplate: "https://example.com/sheet_$M.jpg",
};

const mockFrame: StoryboardFrame = {
  url: "https://example.com/sheet_0.jpg",
  x: 160,
  y: 90,
  sheetWidth: 800,
  sheetHeight: 450,
};

describe("VideoThumbnailPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders nothing when isActive is false", () => {
    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: false,
          frame: mockFrame,
          level: mockLevel,
        })
      );
    });

    expect(host.innerHTML).toBe("");
  });

  it("renders nothing when frame or level is null", () => {
    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: null,
          level: mockLevel,
        })
      );
    });
    expect(host.innerHTML).toBe("");

    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: mockFrame,
          level: null,
        })
      );
    });
    expect(host.innerHTML).toBe("");
  });

  it("renders sprite image with exact percentage dimensions and offsets when active", () => {
    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: mockFrame,
          level: mockLevel,
        })
      );
    });

    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.src).toBe(mockFrame.url);
    expect(img?.getAttribute("aria-hidden")).toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("tabindex")).toBe("-1");

    // columns = 5 -> width: 500%
    // rows = 5 -> height: 500%
    // x = 160, width = 160 -> left: -100%
    // y = 90, height = 90 -> top: -100%
    expect(img?.style.width).toBe("500%");
    expect(img?.style.height).toBe("500%");
    expect(img?.style.left).toBe("-100%");
    expect(img?.style.top).toBe("-100%");

    const wrapper = host.firstElementChild;
    expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper?.className).toContain("pointer-events-none");
    expect(wrapper?.className).toContain("overflow-hidden");
  });

  it("double-buffers across sheet changes so previous frame covers base thumbnail", () => {
    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: mockFrame,
          level: mockLevel,
        })
      );
    });

    const secondFrame: StoryboardFrame = {
      url: "https://example.com/sheet_1.jpg",
      x: 320,
      y: 180,
      sheetWidth: 800,
      sheetHeight: 450,
    };

    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: secondFrame,
          level: mockLevel,
        })
      );
    });

    const images = host.querySelectorAll("img");
    expect(images.length).toBe(2);
    // Back buffer has first frame sheet
    expect(images[0]?.src).toBe(mockFrame.url);
    // Front buffer has second frame sheet
    expect(images[1]?.src).toBe(secondFrame.url);
  });

  it("calculates exact pixel dimensions preserving vertical fit and aspect ratio", () => {
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({
      width: 320,
      height: 180,
      top: 0,
      left: 0,
      bottom: 180,
      right: 320,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    try {
      act(() => {
        root.render(
          createElement(VideoThumbnailPreview, {
            isActive: true,
            frame: mockFrame,
            level: mockLevel,
          })
        );
      });

      const img = host.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.style.width).toBe("1600px");
      expect(img?.style.height).toBe("900px");
      expect(img?.style.left).toBe("-320px");
      expect(img?.style.top).toBe("-180px");

      const viewport = img?.parentElement as HTMLDivElement;
      expect(viewport).not.toBeNull();
      expect(viewport.style.overflow).toBe("hidden");
      expect(viewport.style.width).toBe("320px");
      expect(viewport.style.height).toBe("180px");
      expect(viewport.style.left).toBe("0px");
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("strictly isolates vertical (portrait) video frames within a centered single-tile viewport", () => {
    const portraitLevel: StoryboardLevel = {
      width: 100,
      height: 200,
      count: 9,
      columns: 3,
      rows: 3,
      intervalMs: 2000,
      urlTemplate: "https://example.com/portrait_$M.jpg",
    };
    const portraitFrame: StoryboardFrame = {
      url: "https://example.com/portrait_0.jpg",
      x: 100, // column index 1 (center column)
      y: 0,
      sheetWidth: 300,
      sheetHeight: 600,
    };

    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({
      width: 360,
      height: 200,
      top: 0,
      left: 0,
      bottom: 200,
      right: 360,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    try {
      act(() => {
        root.render(
          createElement(VideoThumbnailPreview, {
            isActive: true,
            frame: portraitFrame,
            level: portraitLevel,
          })
        );
      });

      const img = host.querySelector("img");
      expect(img).not.toBeNull();
      // Tile height matches container height (200px), scale = 1.0 -> tileWidth = 100px
      // Centered: tileLeft = (360 - 100) / 2 = 130px
      const viewport = img?.parentElement as HTMLDivElement;
      expect(viewport).not.toBeNull();
      expect(viewport.style.overflow).toBe("hidden");
      expect(viewport.style.width).toBe("100px");
      expect(viewport.style.height).toBe("200px");
      expect(viewport.style.left).toBe("130px");

      // Sheet has 3 columns -> width: 300px, 3 rows -> height: 600px
      // For column 1 (x = 100), img is offset by -100px inside the 100px-wide viewport,
      // cleanly hiding column 0 (on the left) and column 2 (on the right).
      expect(img?.style.width).toBe("300px");
      expect(img?.style.height).toBe("600px");
      expect(img?.style.left).toBe("-100px");
      expect(img?.style.top).toBe("0px");
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("renders a 2px progress bar reflecting current playback progress", () => {
    act(() => {
      root.render(
        createElement(VideoThumbnailPreview, {
          isActive: true,
          frame: mockFrame,
          level: mockLevel,
          progressPercent: 40,
        })
      );
    });

    const progressBar = host.querySelector(".bg-primary");
    expect(progressBar).not.toBeNull();
    expect((progressBar as HTMLElement)?.style.width).toBe("40%");
  });
});
