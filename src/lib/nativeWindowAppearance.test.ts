import { expect, it, vi } from "vitest";
import { invokeBackend } from "./api/errors";
import { setNativeWindowBackground } from "./nativeWindowAppearance";

vi.mock("./api/errors", () => ({ invokeBackend: vi.fn().mockResolvedValue(undefined) }));

it("passes the palette color as a required command argument instead of silently clearing it", async () => {
  await setNativeWindowBackground("#11111b");
  expect(invokeBackend).toHaveBeenCalledWith("set_window_background", { color: "#11111b" });
});
