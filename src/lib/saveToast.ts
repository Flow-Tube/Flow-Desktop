import { getString } from "./i18n/index";
import { useUiStore, type ToastAction, type ToastImageShape } from "../store/useUiStore";

/** Where a save, like or add put the item. */
export type SaveDestination =
  | { kind: "watchLater" }
  | { kind: "likes" }
  | { kind: "savedShorts" }
  | { kind: "library" }
  | { kind: "albums" }
  | { kind: "queue" }
  | { kind: "playlist"; id: string; name: string }
  | { kind: "album"; path: string; name: string };

export interface SavedItem {
  title: string;
  image?: string | null;
  shape: ToastImageShape;
}

export interface SaveToastOptions {
  destination: SaveDestination;
  item: SavedItem;
  /** The item was taken out of the destination rather than put in. */
  removed?: boolean;
  undo?: () => unknown;
}

export interface SaveFailedToastOptions {
  destination: SaveDestination;
  item: SavedItem;
  removed?: boolean;
  retry?: () => unknown;
}

function destinationName(destination: SaveDestination): string {
  switch (destination.kind) {
    case "watchLater":
      return getString("library_watch_later_label");
    case "likes":
      return getString("library_likes_label");
    case "savedShorts":
      return getString("library_saved_shorts_label");
    case "library":
      return getString("toast_your_library");
    case "albums":
      return getString("albums_title");
    case "queue":
      return getString("toast_queue");
    case "playlist":
    case "album":
      return destination.name;
  }
}

/** The page the item can be found on, or null when there is none to open. */
export function destinationPath(destination: SaveDestination): string | null {
  switch (destination.kind) {
    case "watchLater":
      return "/watch-later";
    case "likes":
      return "/liked";
    case "savedShorts":
      return "/saved-shorts";
    case "library":
      return "/playlists";
    case "albums":
      return "/albums";
    case "queue":
      return null;
    case "playlist":
      return `/playlist/${destination.id}`;
    case "album":
      return destination.path;
  }
}

function headline(destination: SaveDestination, removed: boolean): string {
  if (removed) return getString("toast_removed_from", destinationName(destination));
  const saved = destination.kind === "watchLater" || destination.kind === "library" || destination.kind === "albums";
  return getString(saved ? "toast_saved_to" : "toast_added_to", destinationName(destination));
}

/** Runs a possibly async step and reports a failure as a toast of its own. */
function guarded(step: () => unknown): () => void {
  return () => {
    void Promise.resolve()
      .then(step)
      .catch((error) => {
        console.error("Toast action failed", error);
        useUiStore.getState().showToast({ variant: "error", message: getString("toast_action_failed") });
      });
  };
}

/** A save, like or add, with the item's poster and buttons to open where it went or undo it. */
export function showSaveToast({ destination, item, removed = false, undo }: SaveToastOptions): void {
  const actions: ToastAction[] = [];
  if (undo) actions.push({ label: getString("undo"), onSelect: guarded(undo) });
  const path = removed ? null : destinationPath(destination);
  if (path) actions.push({ label: getString("toast_view"), to: path });

  useUiStore.getState().showToast({
    variant: "success",
    title: headline(destination, removed),
    message: item.title,
    image: item.image,
    imageShape: item.shape,
    actions,
  });
}

/** A save, like or add that did not go through, naming the item and offering to try again. */
export function showSaveFailedToast({ destination, item, removed = false, retry }: SaveFailedToastOptions): void {
  useUiStore.getState().showToast({
    variant: "error",
    title: getString(removed ? "toast_remove_failed" : "toast_save_failed", destinationName(destination)),
    message: item.title,
    actions: retry ? [{ label: getString("retry"), onSelect: guarded(retry) }] : [],
  });
}
