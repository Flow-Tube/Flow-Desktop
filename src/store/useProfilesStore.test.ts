import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api/profiles", () => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  renameProfile: vi.fn(),
  setProfileLook: vi.fn(),
  deleteProfile: vi.fn(),
}));

import * as api from "../lib/api/profiles";
import { copyParts, useProfilesStore } from "./useProfilesStore";

const avatar = { kind: "initial", emoji: "", photoVersion: 0 };
const study = { id: "study", name: "Study", colorKey: "teal", avatar, createdAt: 1, splashTone: "" };
const view = { profiles: [study], defaultId: "d", activeId: "d", maxProfiles: 5 };

beforeEach(() => {
  vi.mocked(api.listProfiles).mockResolvedValue(view);
  useProfilesStore.setState({ view, loading: false, loadError: null });
  localStorage.clear();
});

describe("useProfilesStore", () => {
  it("copies only profile settings, and only when asked", () => {
    const parts = copyParts({ settings: true, subscriptions: false, recommendations: true });
    expect(parts.settings).toContain("theme_id");
    expect(parts.settings).not.toContain("download_location");
    expect(parts.recommendations).toBe(true);
    expect(copyParts({ settings: false, subscriptions: true, recommendations: false }).settings).toEqual([]);
  });

  it("rolls a rename back when the backend refuses it", async () => {
    vi.mocked(api.renameProfile).mockRejectedValue(new Error("taken"));
    await expect(useProfilesStore.getState().rename("study", "Default")).rejects.toThrow("taken");
    expect(useProfilesStore.getState().view?.profiles[0]?.name).toBe("Study");
  });

  it("drops a deleted profile's web storage", async () => {
    vi.mocked(api.deleteProfile).mockResolvedValue();
    localStorage.setItem("p:study:flow_search_history", "[]");
    localStorage.setItem("flow_search_history", "[]");
    await useProfilesStore.getState().remove("study");
    expect(localStorage.getItem("p:study:flow_search_history")).toBeNull();
    expect(localStorage.getItem("flow_search_history")).toBe("[]");
  });

  it("copies the UI keys into a new profile when settings are copied", async () => {
    vi.mocked(api.createProfile).mockResolvedValue({ ...study, id: "new" });
    localStorage.setItem("flow_theater_mode", "true");
    await useProfilesStore.getState().create(
      { name: "New", colorKey: "", avatar },
      { settings: true, subscriptions: false, recommendations: false },
    );
    expect(localStorage.getItem("p:new:flow_theater_mode")).toBe("true");
  });

  it("opens a fresh profile in the default theme", async () => {
    vi.mocked(api.createProfile).mockResolvedValue({ ...study, id: "fresh" });
    await useProfilesStore.getState().create(
      { name: "Fresh", colorKey: "", avatar },
      { settings: false, subscriptions: false, recommendations: false },
    );
    expect(JSON.parse(localStorage.getItem("p:fresh:flow_boot_theme") ?? "{}").variant).toBe("dark");
  });
});
