import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const takeLaunchProfileQuestion = vi.fn();
const listProfiles = vi.fn();
vi.mock("../../lib/api/profiles", () => ({
  takeLaunchProfileQuestion: () => takeLaunchProfileQuestion(),
  listProfiles: () => listProfiles(),
}));
vi.mock("../../lib/profiles/switchProfile", () => ({ switchProfile: vi.fn(async () => undefined) }));

import { switchProfile } from "../../lib/profiles/switchProfile";
import { useProfilesStore } from "../../store/useProfilesStore";
import { WhosWatchingOverlay } from "./WhosWatchingOverlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const avatar = { kind: "initial", emoji: "", photoVersion: 0 };
const mine = { id: "d", name: "Me", colorKey: "blue", avatar, createdAt: 1, splashTone: "" };
const study = { id: "s", name: "Study", colorKey: "teal", avatar, createdAt: 2, splashTone: "" };
const view = { profiles: [mine, study], photos: {}, defaultId: "d", activeId: "d", maxProfiles: 5, askWhosWatching: true };

describe("WhosWatchingOverlay", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    listProfiles.mockResolvedValue(view);
    useProfilesStore.setState({ view: null, switchingTo: null });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const mount = async () => {
    await act(async () => root.render(createElement(WhosWatchingOverlay)));
  };
  const button = (name: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(name))!;

  it("stays away when this launch shouldn't ask", async () => {
    takeLaunchProfileQuestion.mockResolvedValue(false);
    await mount();
    expect(host.textContent).toBe("");
  });

  it("stays away when the backend can't say, so launch still works", async () => {
    takeLaunchProfileQuestion.mockRejectedValue(new Error("registry"));
    await mount();
    expect(host.textContent).toBe("");
  });

  it("asks under StrictMode, where the effect runs twice and the backend says yes only once", async () => {
    takeLaunchProfileQuestion.mockResolvedValueOnce(true).mockResolvedValue(false);
    await act(async () => root.render(createElement(StrictMode, null, createElement(WhosWatchingOverlay))));
    expect(host.textContent).toContain("Who's watching?");
    expect(takeLaunchProfileQuestion).toHaveBeenCalledTimes(1);
  });

  it("lists the profiles, and picking the open one just closes it", async () => {
    takeLaunchProfileQuestion.mockResolvedValue(true);
    await mount();
    expect(host.textContent).toContain("Who's watching?");
    expect(host.textContent).toContain("Study");
    await act(async () => button("Me").click());
    expect(host.textContent).toBe("");
    expect(switchProfile).not.toHaveBeenCalled();
  });

  it("switches to another profile", async () => {
    takeLaunchProfileQuestion.mockResolvedValue(true);
    await mount();
    await act(async () => button("Study").click());
    expect(switchProfile).toHaveBeenCalledWith(study);
  });

  it("Escape stays on the open profile", async () => {
    takeLaunchProfileQuestion.mockResolvedValue(true);
    await mount();
    await act(async () => {
      host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.textContent).toBe("");
  });
});
