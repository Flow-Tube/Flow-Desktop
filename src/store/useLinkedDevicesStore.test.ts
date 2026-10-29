import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  addDevice: vi.fn(),
  answerCode: vi.fn(),
  cancelLink: vi.fn(),
  createGroup: vi.fn(),
  createLanGroup: vi.fn(),
  forgetGroup: vi.fn(),
  getLinkPhase: vi.fn(),
  getLinkedDevices: vi.fn(),
  getLinkedStatus: vi.fn(),
  enterCode: vi.fn(),
  showCode: vi.fn(),
  markRecoverySaved: vi.fn(),
  onLinkPhase: vi.fn(),
  onSynced: vi.fn(),
  removeDevice: vi.fn(),
  renameDevice: vi.fn(),
  restoreGroup: vi.fn(),
  syncNow: vi.fn(),
}));
vi.mock("../lib/api/linked", () => api);

import { useLinkedDevicesStore } from "./useLinkedDevicesStore";

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i}`).join(" ");
const LINKED = { linked: true, onLan: false, storeUrl: "https://sync.example.com", recoverySaved: false, lastSync: null };

beforeEach(() => {
  vi.clearAllMocks();
  useLinkedDevicesStore.setState({ status: null, devices: null, words: null, error: null, busy: false });
});

describe("useLinkedDevicesStore", () => {
  it("keeps the recovery words from a new group until they are confirmed", async () => {
    api.createGroup.mockResolvedValue(WORDS);
    api.getLinkedStatus.mockResolvedValue(LINKED);
    api.getLinkedDevices.mockResolvedValue([{ id: "a", name: "Mac", platform: "macos", thisDevice: true }]);

    await useLinkedDevicesStore.getState().create("https://sync.example.com", "token");
    expect(api.createGroup).toHaveBeenCalledWith("https://sync.example.com", "token");
    expect(useLinkedDevicesStore.getState().words).toBe(WORDS);
    expect(useLinkedDevicesStore.getState().devices).toHaveLength(1);

    api.getLinkedStatus.mockResolvedValue({ ...LINKED, recoverySaved: true });
    await useLinkedDevicesStore.getState().confirmSaved();
    expect(api.markRecoverySaved).toHaveBeenCalled();
    expect(useLinkedDevicesStore.getState().words).toBeNull();
    expect(useLinkedDevicesStore.getState().status?.recoverySaved).toBe(true);
  });

  it("shows a backend failure as its translated message and clears busy", async () => {
    api.restoreGroup.mockRejectedValue({ kind: "linkedWrongWords", message: "these recovery words are not valid" });

    await useLinkedDevicesStore.getState().restore("https://sync.example.com", "nope");
    const state = useLinkedDevicesStore.getState();
    expect(state.error).toBe("These recovery words aren't valid. Check the spelling and the order.");
    expect(state.busy).toBe(false);
    expect(state.words).toBeNull();
  });

  it("loads no devices for a device in no group", async () => {
    api.getLinkedStatus.mockResolvedValue({ linked: false, onLan: false, storeUrl: null, recoverySaved: false, lastSync: null });

    await useLinkedDevicesStore.getState().refresh();
    expect(api.getLinkedDevices).not.toHaveBeenCalled();
    expect(useLinkedDevicesStore.getState().devices).toBeNull();
  });
});
