import { beforeEach, describe, expect, it, vi } from "vitest";
import { destinationPath, showSaveFailedToast, showSaveToast } from "./saveToast";
import { getString } from "./i18n/index";
import {
  TOAST_DURATION_MS,
  TOAST_WITH_ACTIONS_DURATION_MS,
  useUiStore,
} from "../store/useUiStore";

const item = { title: "How the telescope unfolded", image: "https://i.ytimg.com/vi/x/hq.jpg", shape: "landscape" as const };
const toast = () => useUiStore.getState().toast;

describe("showSaveToast", () => {
  beforeEach(() => useUiStore.setState({ toast: null }));

  it("names where the item went and shows its poster", () => {
    showSaveToast({ destination: { kind: "watchLater" }, item });
    expect(toast()).toMatchObject({
      variant: "success",
      title: getString("toast_saved_to", getString("library_watch_later_label")),
      message: item.title,
      image: item.image,
      imageShape: "landscape",
    });
  });

  it("offers Undo then View, and View opens the destination", () => {
    showSaveToast({ destination: { kind: "playlist", id: "PL1", name: "Synthwave" }, item, undo: () => {} });
    const actions = toast()?.actions ?? [];
    expect(actions.map((action) => action.label)).toEqual([getString("undo"), getString("toast_view")]);
    expect(actions[1]?.to).toBe("/playlist/PL1");
    expect(toast()?.title).toBe(getString("toast_added_to", "Synthwave"));
  });

  it("gives a removal only Undo", () => {
    showSaveToast({ destination: { kind: "likes" }, item, removed: true, undo: () => {} });
    expect(toast()?.title).toBe(getString("toast_removed_from", getString("library_likes_label")));
    expect(toast()?.actions.map((action) => action.label)).toEqual([getString("undo")]);
  });

  it("runs Undo, and reports a failed one", async () => {
    const undo = vi.fn().mockRejectedValue(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    showSaveToast({ destination: { kind: "queue" }, item, undo });
    toast()?.actions[0]?.onSelect?.();
    await vi.waitFor(() => expect(toast()?.variant).toBe("error"));
    expect(undo).toHaveBeenCalledOnce();
    expect(toast()?.message).toBe(getString("toast_action_failed"));
  });

  it("has nothing to view for the queue", () => {
    expect(destinationPath({ kind: "queue" })).toBeNull();
    showSaveToast({ destination: { kind: "queue" }, item });
    expect(toast()?.actions).toEqual([]);
  });
});

describe("showSaveFailedToast", () => {
  beforeEach(() => useUiStore.setState({ toast: null }));

  it("names the item and offers Retry", () => {
    const retry = vi.fn();
    showSaveFailedToast({ destination: { kind: "savedShorts" }, item, removed: true, retry });
    expect(toast()).toMatchObject({
      variant: "error",
      title: getString("toast_remove_failed", getString("library_saved_shorts_label")),
      message: item.title,
    });
    toast()?.actions[0]?.onSelect?.();
    return vi.waitFor(() => expect(retry).toHaveBeenCalledOnce());
  });
});

describe("toast store", () => {
  beforeEach(() => useUiStore.setState({ toast: null }));

  it("keeps a toast with buttons up longer", () => {
    useUiStore.getState().showToast({ message: "Copied" });
    expect(toast()?.durationMs).toBe(TOAST_DURATION_MS);
    useUiStore.getState().showToast({ message: "Saved", actions: [{ label: "Undo" }] });
    expect(toast()?.durationMs).toBe(TOAST_WITH_ACTIONS_DURATION_MS);
  });

  it("keeps at most two buttons, the main one last", () => {
    useUiStore.getState().showToast({ message: "x", actions: [{ label: "a" }, { label: "b" }, { label: "c" }] });
    expect(toast()?.actions.map((action) => action.label)).toEqual(["b", "c"]);
  });

  it("only dismisses the toast it was asked to", () => {
    useUiStore.getState().showToast({ message: "first" });
    const first = toast()?.id;
    useUiStore.getState().showToast({ message: "second" });
    useUiStore.getState().dismissToast(first);
    expect(toast()?.message).toBe("second");
    useUiStore.getState().dismissToast();
    expect(toast()).toBeNull();
  });
});
