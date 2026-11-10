import { describe, it, expect, beforeEach } from "vitest";
import { useHoverPreviewStore } from "./useHoverPreviewStore";

describe("useHoverPreviewStore", () => {
  beforeEach(() => {
    useHoverPreviewStore.setState({ activeVideoId: null });
  });

  it("starts with no active video ID", () => {
    expect(useHoverPreviewStore.getState().activeVideoId).toBeNull();
  });

  it("sets active video ID", () => {
    useHoverPreviewStore.getState().setActiveVideoId("video123");
    expect(useHoverPreviewStore.getState().activeVideoId).toBe("video123");
  });

  it("clears active video ID only when ID matches", () => {
    useHoverPreviewStore.getState().setActiveVideoId("video123");
    useHoverPreviewStore.getState().clearActive("otherVideo");
    expect(useHoverPreviewStore.getState().activeVideoId).toBe("video123");

    useHoverPreviewStore.getState().clearActive("video123");
    expect(useHoverPreviewStore.getState().activeVideoId).toBeNull();
  });

  it("clears active unconditionally if no ID is passed", () => {
    useHoverPreviewStore.getState().setActiveVideoId("video123");
    useHoverPreviewStore.getState().clearActive();
    expect(useHoverPreviewStore.getState().activeVideoId).toBeNull();
  });
});
