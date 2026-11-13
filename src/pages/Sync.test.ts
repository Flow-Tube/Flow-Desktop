// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinkedDevice, LinkedStatus } from "../lib/api/linked";

vi.mock("../lib/live/useConsents", () => ({ useConsents: () => [{}, vi.fn()] }));
vi.mock("../lib/linked/useLinkedProfiles", () => ({
  useLinkedProfiles: () => ({ profiles: { local: [], synced: [], chooseForDefault: false }, error: null, busy: false }),
}));
vi.mock("../lib/linked/visiblePoll", () => ({ pollWhileVisible: () => () => {} }));
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, AnimatePresence: ({ children }: { children: unknown }) => children };
});

const { default: Sync } = await import("./Sync");
const { useSyncStore } = await import("../store/useSyncStore");
const { useLinkedDevicesStore } = await import("../store/useLinkedDevicesStore");
const { useProfilesStore } = await import("../store/useProfilesStore");
const { useDashboardStore } = await import("../store/useDashboardStore");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (overrides: Partial<LinkedStatus> = {}): LinkedStatus => ({
  kind: null,
  loginRefused: false,
  loginDue: false,
  keychainBlocked: false,
  recoverySaved: true,
  recoveryNotice: null,
  recoveryDue: false,
  syncing: false,
  ...overrides,
});

const device = (id: string, name: string, thisDevice = false): LinkedDevice => ({
  id,
  name,
  platform: thisDevice ? "desktop" : "android",
  thisDevice,
  setRecoveryKey: false,
  nearby: false,
  lastSyncMs: Date.now() - 60_000,
});

let root: Root;
const host = document.createElement("div");
const text = () => host.textContent ?? "";
const press = (label: string) => {
  const target = [...host.querySelectorAll<HTMLElement>("button")].find(
    (button) => button.getAttribute("data-setting-title") === label || button.getAttribute("aria-label") === label || button.textContent?.trim() === label,
  );
  if (!target) throw new Error(`No button "${label}"`);
  act(() => target.click());
};
const render = () => act(() => root.render(createElement(MemoryRouter, null, createElement(Sync))));

beforeEach(() => {
  useSyncStore.setState({ init: async () => {}, status: { phase: "idle" }, error: null, busy: false, device: { deviceName: "Studio Mac" } as never });
  useLinkedDevicesStore.setState({
    init: async () => {},
    loadJoinRequests: async () => {},
    status: status(),
    devices: null,
    devicesError: null,
    joinRequests: [],
    link: { phase: "idle" },
    words: null,
    error: null,
    busy: false,
  });
  useProfilesStore.setState({ load: async () => {}, view: null } as never);
  useDashboardStore.setState({ load: async () => {}, dashboard: null });
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Sync page, not in a group", () => {
  it("lists the ways in and the one-time transfer, with no form open", () => {
    render();
    for (const label of ["Join a group", "Start a group", "Restore with recovery key", "Send to a nearby device", "Receive from a nearby device"]) {
      expect(host.querySelector(`button[data-setting-title="${label}"]`)).not.toBeNull();
    }
    expect(host.querySelector("input")).toBeNull();
    expect(text()).toContain("Studio Mac");
  });

  it("opens a task as its own view and goes back to the list", () => {
    render();
    press("Start a group");
    expect(text()).toContain("Create group");
    expect(host.querySelector('button[data-setting-title="Join a group"]')).toBeNull();
    press("Back");
    expect(host.querySelector('button[data-setting-title="Join a group"]')).not.toBeNull();
  });

  it("goes back to the list once joining has put this device in a group", () => {
    render();
    press("Join a group");
    act(() => useLinkedDevicesStore.setState({ status: status({ kind: "lan" }), devices: [device("a", "Studio Mac", true)] }));
    expect(text()).toContain("Sync now");
    expect(text()).not.toContain("Paste the code");
  });

  it("lists every collection to send, and sends from Default only", () => {
    render();
    press("Send to a nearby device");
    expect(text()).toContain("Watch history");
    expect(text()).toContain("Generate Sync Code");

    const profile = (id: string) => ({ id, name: id, colorKey: 0, avatar: { kind: "initial" } });
    act(() =>
      useProfilesStore.setState({
        view: { activeId: "kids", defaultId: "main", profiles: [profile("main"), profile("kids")], photos: {}, maxProfiles: 5 },
      } as never),
    );
    expect(text()).not.toContain("Generate Sync Code");
  });

  it("shows a transfer under way in place of the list, without a back arrow", () => {
    useSyncStore.setState({ status: { phase: "connecting" } as never });
    render();
    expect(text()).toContain("One-time transfer");
    expect(host.querySelector('button[aria-label="Back"]')).toBeNull();
  });
});

describe("Sync page, in a group", () => {
  it("shows the group as rows: status, devices, the group, and the transfer", () => {
    useLinkedDevicesStore.setState({
      status: status({ kind: "server", storeUrl: "https://sync.home.lan", recoverySaved: false }),
      devices: [device("a", "Studio Mac", true), device("b", "Pixel 8")],
    });
    useDashboardStore.setState({
      dashboard: { kind: "server", storeUrl: "https://sync.home.lan", server: null, storage: { used: 1_200_000, quota: 1e9, objects: 418 }, errors: [], profiles: [] } as never,
    });
    render();
    expect(text()).toContain("https://sync.home.lan");
    expect(text()).toContain("Pixel 8");
    expect(host.querySelector('button[data-setting-title="Link a device"]')).not.toBeNull();
    expect(text()).toContain("Your recovery key isn't confirmed");
    expect(text()).toContain("Storage");
    expect(text()).toContain("Leave the group on this device");
    expect(text()).toContain("Receive from a nearby device");
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("asks before leaving", () => {
    useLinkedDevicesStore.setState({ status: status({ kind: "lan" }), devices: [device("a", "Studio Mac", true)] });
    const leave = vi.fn(async () => {});
    useLinkedDevicesStore.setState({ leave });
    render();
    press("Leave");
    expect(leave).not.toHaveBeenCalled();
    expect(text()).toContain("Leave the group on this device?");
    press("Leave");
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("puts a blocked keychain in place of the group", () => {
    useLinkedDevicesStore.setState({ status: status({ kind: "server", keychainBlocked: true }) });
    render();
    expect(host.querySelector('button[data-setting-title="Link a device"]')).toBeNull();
    expect(text()).toContain("Try again");
  });
});
