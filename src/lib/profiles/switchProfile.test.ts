import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async (event: string) => {
    calls.push(`emit ${event}`);
  }),
  listen: vi.fn(async () => () => undefined),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getAllWebviewWindows: vi.fn(async () => [{ label: "main" }, { label: "botguard-1" }]),
}));
vi.mock("../appWindow", () => ({ CURRENT_WINDOW_LABEL: "main" }));
vi.mock("../api/pip", () => ({ closePipWindow: vi.fn(async () => calls.push("closePip")) }));
vi.mock("../api/discord", () => ({ clearDiscordPresence: vi.fn(async () => calls.push("clearDiscord")) }));
vi.mock("../api/profiles", () => ({
  prepareProfileSwitch: vi.fn(async () => calls.push("prepare")),
  cancelProfileSwitch: vi.fn(async () => calls.push("cancel")),
  finishProfileSwitch: vi.fn(async () => calls.push("finish")),
}));
vi.mock("./beforeSwitch", () => ({ runBeforeProfileSwitch: vi.fn(async () => calls.push("save")) }));

import * as profilesApi from "../api/profiles";
import { switchProfile, SWITCHING_TO_KEY, takeSwitchingTo } from "./switchProfile";

const study = {
  id: "study",
  name: "Study",
  colorKey: "teal",
  avatar: { kind: "initial", emoji: "", photoVersion: 0 },
  createdAt: 1,
  splashTone: "",
};

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  vi.useRealTimers();
});

describe("switchProfile", () => {
  it("saves every window before making the profile active", async () => {
    await switchProfile(study);
    expect(calls).toEqual(["prepare", "closePip", "emit profile://prepare-switch", "save", "clearDiscord", "finish"]);
    expect(JSON.parse(localStorage.getItem(SWITCHING_TO_KEY) ?? "{}").id).toBe("study");
  });

  it("changes nothing when the switch is refused", async () => {
    vi.mocked(profilesApi.prepareProfileSwitch).mockRejectedValueOnce(new Error("syncRunning"));
    await expect(switchProfile(study)).rejects.toThrow("syncRunning");
    expect(calls).toEqual([]);
  });

  it("cancels the switch when the last step fails", async () => {
    vi.mocked(profilesApi.finishProfileSwitch).mockRejectedValueOnce(new Error("disk full"));
    await expect(switchProfile(study)).rejects.toThrow("disk full");
    expect(calls[calls.length - 1]).toBe("cancel");
    expect(localStorage.getItem(SWITCHING_TO_KEY)).toBeNull();
  });

  it("hands the target to the next process's loading screen once", () => {
    localStorage.setItem(SWITCHING_TO_KEY, JSON.stringify(study));
    expect(takeSwitchingTo()?.id).toBe("study");
    expect(takeSwitchingTo()).toBeNull();
  });
});
