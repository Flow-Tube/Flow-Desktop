import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api/env", () => ({ isTauriEnv: vi.fn().mockResolvedValue(true) }));
vi.mock("./api/errors", () => ({ invokeBackend: vi.fn() }));
vi.mock("./clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));

import { invokeBackend } from "./api/errors";
import { copyText } from "./clipboard";
import { openExternal, openExternalOrOfferCopy } from "./openExternal";
import { useUiStore } from "../store/useUiStore";

afterEach(() => {
  vi.mocked(invokeBackend).mockReset();
  useUiStore.setState({ toast: null } as never);
});

describe("openExternal", () => {
  it("asks the backend to open the link", async () => {
    vi.mocked(invokeBackend).mockResolvedValue(undefined);
    await expect(openExternal("https://www.youtube.com/watch?v=abc")).resolves.toBe(true);
    expect(invokeBackend).toHaveBeenCalledWith("open_external", { url: "https://www.youtube.com/watch?v=abc" });
  });

  it("reports when nothing could open it", async () => {
    vi.mocked(invokeBackend).mockRejectedValue(new Error("No program could open it"));
    await expect(openExternal("https://example.com")).resolves.toBe(false);
  });
});

describe("openExternalOrOfferCopy", () => {
  it("offers to copy a link no browser opened", async () => {
    vi.mocked(invokeBackend).mockRejectedValue(new Error("No program could open it"));
    await openExternalOrOfferCopy("https://example.com/watch");
    const toast = useUiStore.getState().toast;
    expect(toast?.variant).toBe("error");
    toast?.action?.onSelect();
    expect(copyText).toHaveBeenCalledWith("https://example.com/watch");
  });

  it("stays quiet when the link opened", async () => {
    vi.mocked(invokeBackend).mockResolvedValue(undefined);
    await openExternalOrOfferCopy("https://example.com/watch");
    expect(useUiStore.getState().toast).toBeNull();
  });
});
