import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  acceptJoin: vi.fn(),
  addDevice: vi.fn(),
  askToJoin: vi.fn(),
  declineJoin: vi.fn(),
  getJoinRequests: vi.fn(),
  answerCode: vi.fn(),
  cancelLink: vi.fn(),
  createGroup: vi.fn(),
  createLanGroup: vi.fn(),
  createWebdavGroup: vi.fn(),
  forgetGroup: vi.fn(),
  getLinkPhase: vi.fn(),
  getLinkedDevices: vi.fn(),
  getLinkedStatus: vi.fn(),
  leaveGroup: vi.fn(),
  enterCode: vi.fn(),
  showCode: vi.fn(),
  markRecoverySaved: vi.fn(),
  onLinkPhase: vi.fn(),
  onSynced: vi.fn(),
  removeDevice: vi.fn(),
  renameDevice: vi.fn(),
  restoreGroup: vi.fn(),
  retryKeychain: vi.fn(),
  syncNow: vi.fn(),
  updateLogin: vi.fn(),
}));
vi.mock("../lib/api/linked", () => api);
const confirmAction = vi.hoisted(() => vi.fn());
vi.mock("../lib/dialogs", () => ({ confirmAction }));

import { useLinkedDevicesStore } from "./useLinkedDevicesStore";

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i}`).join(" ");
const LINKED = {
  kind: "server",
  storeUrl: "https://sync.example.com",
  keychainBlocked: false,
  recoverySaved: false,
  lastSync: null,
  syncing: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useLinkedDevicesStore.setState({ status: null, devices: null, words: null, serverTaken: false, error: null, busy: false });
});

describe("useLinkedDevicesStore", () => {
  it("keeps the recovery words from a new group until they are confirmed", async () => {
    api.createGroup.mockResolvedValue(WORDS);
    api.getLinkedStatus.mockResolvedValue(LINKED);
    api.getLinkedDevices.mockResolvedValue([{ id: "a", name: "Mac", platform: "macos", thisDevice: true }]);

    await useLinkedDevicesStore.getState().create("https://sync.example.com", "token");
    expect(api.createGroup).toHaveBeenCalledWith("https://sync.example.com", "token", undefined);
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

  it("asks the keychain again, and says it is still waiting when macOS has not answered", async () => {
    api.retryKeychain.mockRejectedValueOnce({ kind: "linkedKeychain", message: "Waiting for access to the keychain" });
    await useLinkedDevicesStore.getState().retryKeychain();
    expect(useLinkedDevicesStore.getState().error).toBe(
      "Flow is waiting for access to the keychain. Allow it when macOS asks, then try again.",
    );

    api.retryKeychain.mockResolvedValueOnce(undefined);
    api.getLinkedStatus.mockResolvedValue(LINKED);
    api.getLinkedDevices.mockResolvedValue([]);
    await useLinkedDevicesStore.getState().retryKeychain();
    expect(useLinkedDevicesStore.getState().error).toBeNull();
    expect(useLinkedDevicesStore.getState().status?.keychainBlocked).toBe(false);
  });

  it("loads no devices for a device in no group", async () => {
    api.getLinkedStatus.mockResolvedValue({ kind: null, storeUrl: null, recoverySaved: false, lastSync: null, syncing: false });

    await useLinkedDevicesStore.getState().refresh();
    expect(api.getLinkedDevices).not.toHaveBeenCalled();
    expect(useLinkedDevicesStore.getState().devices).toBeNull();
  });

  it("lists join requests quietly and drops one once it is answered", async () => {
    const phone = { id: "a".repeat(32), name: "Phone", expires: 1 };
    api.getJoinRequests.mockResolvedValue([phone]);
    await useLinkedDevicesStore.getState().loadJoinRequests();
    expect(useLinkedDevicesStore.getState().joinRequests).toEqual([phone]);

    await useLinkedDevicesStore.getState().declineJoin(phone.id);
    expect(api.declineJoin).toHaveBeenCalledWith(phone.id);
    expect(useLinkedDevicesStore.getState().joinRequests).toEqual([]);

    api.getJoinRequests.mockRejectedValue({ kind: "linkedRefused", message: "not found" });
    await useLinkedDevicesStore.getState().loadJoinRequests();
    expect(useLinkedDevicesStore.getState().error).toBeNull();
  });

  it("tells what a sync the user asked for brought in, and nothing for an empty one", async () => {
    const { useUiStore } = await import("./useUiStore");
    const showToast = vi.fn();
    useUiStore.setState({ showToast });
    api.getLinkedStatus.mockResolvedValue(LINKED);
    api.getLinkedDevices.mockResolvedValue([]);

    api.syncNow.mockResolvedValue([{ name: "Pixel", count: 3 }]);
    await useLinkedDevicesStore.getState().syncNow();
    expect(showToast).toHaveBeenCalledWith({ message: "Received 3 changes from Pixel" });

    showToast.mockClear();
    api.syncNow.mockResolvedValue([]);
    await useLinkedDevicesStore.getState().syncNow();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("forgets the group anyway when leaving fails and the user agrees, and says why otherwise", async () => {
    api.getLinkedStatus.mockResolvedValue({ ...LINKED, kind: null });
    api.leaveGroup.mockRejectedValue({ kind: "linkedGroupMissing", message: "unclaimed" });
    confirmAction.mockResolvedValueOnce(true);
    await useLinkedDevicesStore.getState().leave();
    expect(api.forgetGroup).toHaveBeenCalledOnce();
    expect(useLinkedDevicesStore.getState().error).toBeNull();

    confirmAction.mockResolvedValueOnce(false);
    await useLinkedDevicesStore.getState().leave();
    expect(api.forgetGroup).toHaveBeenCalledOnce();
    expect(useLinkedDevicesStore.getState().error).toContain("no longer has this group");
  });

  it("offers a server that already has a group instead of failing, and resets it only when asked", async () => {
    api.createGroup.mockRejectedValueOnce({ kind: "linkedAlreadyClaimed", message: "this server already has a group" });
    await useLinkedDevicesStore.getState().create("https://sync.example.com", "admin");
    expect(useLinkedDevicesStore.getState()).toMatchObject({ serverTaken: true, error: null, words: null });
    expect(api.createGroup).toHaveBeenLastCalledWith("https://sync.example.com", "admin", undefined);

    api.createGroup.mockResolvedValueOnce(WORDS);
    api.getLinkedStatus.mockResolvedValue(LINKED);
    await useLinkedDevicesStore.getState().create("https://sync.example.com", "admin", true);
    expect(api.createGroup).toHaveBeenLastCalledWith("https://sync.example.com", "admin", true);
    expect(useLinkedDevicesStore.getState()).toMatchObject({ serverTaken: false, words: WORDS });
  });
});
