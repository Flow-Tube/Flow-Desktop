import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { useTabsStore } from "../../store/useTabsStore";
import { useUiStore } from "../../store/useUiStore";
import { refreshPage } from "../pageRefresh";
import { IS_MACOS_RUNTIME } from "../platform";
import { FOCUS_SEARCH_EVENT } from "../windowEvents";
import { APP_COMMANDS, appShortcut } from "./appCommands";
import { awaitingSequence } from "./command";
import { shortcutKey } from "./eventKey";
import { chordCaption } from "./format";
import { keyBelongsToTarget } from "./target";

export const TOGGLE_SHORTCUT_HELP_EVENT = "flow:toggle-shortcut-help";
/** Carries the first key of a sequence while Flow waits for the second, then null. */
export const SHORTCUT_SEQUENCE_EVENT = "flow:shortcut-sequence";

const modalOpen = () => document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])') !== null;

/** Mod+P would open the webview's print dialog on Windows; Flow has nothing to print. */
const isPrint = (event: KeyboardEvent) =>
  (IS_MACOS_RUNTIME ? event.metaKey : event.ctrlKey) && !event.altKey && shortcutKey(event) === "p";

/**
 * Every app-wide key in one listener, so a sequence such as G then H is read once per key press. It
 * listens on the way down, ahead of the players, so the H of a go-to key never reaches a player.
 */
export function useAppShortcuts(): void {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const announce = (first: string | null) =>
      window.dispatchEvent(new CustomEvent<string | null>(SHORTCUT_SEQUENCE_EVENT, { detail: first }));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const inField = keyBelongsToTarget(event.target, event.key);
      // A field keeps its keys, apart from Ctrl or Cmd combinations such as Mod+K.
      if (inField && !event.ctrlKey && !event.metaKey) return;
      const wasWaiting = awaitingSequence(APP_COMMANDS);
      const shortcut = appShortcut(event, IS_MACOS_RUNTIME);
      if (awaitingSequence(APP_COMMANDS)) {
        announce(chordCaption(event.key.length === 1 ? event.key.toUpperCase() : event.key, IS_MACOS_RUNTIME));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (wasWaiting) announce(null);
      if (!shortcut) {
        if (isPrint(event)) event.preventDefault();
        return;
      }
      if (inField && shortcut.kind !== "search") return;
      switch (shortcut.kind) {
        case "search":
          window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
          break;
        case "help":
          window.dispatchEvent(new Event(TOGGLE_SHORTCUT_HELP_EVENT));
          break;
        case "back":
          useTabsStore.getState().go(-1);
          break;
        case "forward":
          useTabsStore.getState().go(1);
          break;
        case "refresh":
          refreshPage();
          break;
        case "side-rail":
          useUiStore.getState().toggleSidebar();
          break;
        case "settings":
          if (modalOpen()) return;
          navigateRef.current("/settings");
          break;
        case "go":
          if (modalOpen()) return;
          navigateRef.current(shortcut.path);
          break;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
