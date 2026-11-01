import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDashboard } = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock("../lib/api/linked", () => ({ getDashboard }));

import { getString } from "../lib/i18n/index";
import { useDashboardStore } from "./useDashboardStore";

const dashboard = {
  kind: "server" as const,
  storeUrl: "https://sync.example",
  server: { protocols: ["FLOW-SYNC/2"], live: true },
  storage: { used: 10, quota: 100, objects: 3 },
  errors: [{ kind: "linkedUnreachable", atMs: 5 }],
  profiles: [{ profile: "home", link: "link-home", kept: 2, ownSnapshotMs: null }],
};

beforeEach(() => {
  getDashboard.mockReset();
  useDashboardStore.setState({ dashboard: null, error: null, loading: false });
});

describe("useDashboardStore", () => {
  it("loads what the backend reports", async () => {
    getDashboard.mockResolvedValue(dashboard);
    await useDashboardStore.getState().load();
    expect(useDashboardStore.getState()).toMatchObject({ dashboard, error: null, loading: false });
  });

  it("keeps the last dashboard and shows why a load failed", async () => {
    getDashboard.mockResolvedValueOnce(dashboard);
    await useDashboardStore.getState().load();
    getDashboard.mockRejectedValueOnce({ kind: "linkedNotLinked", message: "not linked" });
    await useDashboardStore.getState().load();
    const state = useDashboardStore.getState();
    expect(state.dashboard).toEqual(dashboard);
    expect(state.error).toBe(getString("linked_error_not_linked"));
  });
});
