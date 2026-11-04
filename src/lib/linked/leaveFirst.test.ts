import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  forgetGroup: vi.fn(),
  getLinkedStatus: vi.fn(),
  leaveGroup: vi.fn(),
}));
const confirmAction = vi.hoisted(() => vi.fn());
vi.mock("../api/linked", () => api);
vi.mock("../api/env", () => ({ isTauriEnv: async () => true }));
vi.mock("../dialogs", () => ({ confirmAction }));

import { leaveGroupFirst } from "./leaveFirst";

describe("leaveGroupFirst", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getLinkedStatus.mockResolvedValue({ kind: "server" });
  });

  it("leaves the group and goes on", async () => {
    await expect(leaveGroupFirst()).resolves.toBe(true);
    expect(api.leaveGroup).toHaveBeenCalledOnce();
    expect(api.forgetGroup).not.toHaveBeenCalled();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("does nothing for a device in no group", async () => {
    api.getLinkedStatus.mockResolvedValue({ kind: null });
    await expect(leaveGroupFirst()).resolves.toBe(true);
    expect(api.leaveGroup).not.toHaveBeenCalled();
  });

  it("forgets the group anyway when leaving fails and the user agrees", async () => {
    api.leaveGroup.mockRejectedValue({ kind: "linkedGroupMissing", message: "unclaimed" });
    confirmAction.mockResolvedValue(true);
    await expect(leaveGroupFirst()).resolves.toBe(true);
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("no longer has this group"), expect.any(String));
    expect(api.forgetGroup).toHaveBeenCalledOnce();
  });

  it("keeps the group, and stops the reset, when the user says no", async () => {
    api.leaveGroup.mockRejectedValue({ kind: "linkedUnreachable", message: "offline" });
    confirmAction.mockResolvedValue(false);
    await expect(leaveGroupFirst()).resolves.toBe(false);
    expect(api.forgetGroup).not.toHaveBeenCalled();
  });
});
