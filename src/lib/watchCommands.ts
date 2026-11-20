import { useEffect, useRef } from "react";

/**
 * Keys for things the watch page and the Shorts action bar own: liking, saving, comments. The key
 * listeners send the command, and whichever of those is on screen acts on it with its own logic.
 */
export type WatchCommand = "like" | "dislike" | "watch-later" | "add-to-playlist" | "comments";

const WATCH_COMMAND_EVENT = "flow:watch-command";

export function sendWatchCommand(command: WatchCommand): void {
  window.dispatchEvent(new CustomEvent<WatchCommand>(WATCH_COMMAND_EVENT, { detail: command }));
}

export function useWatchCommands(handle: (command: WatchCommand) => void): void {
  const latest = useRef(handle);
  latest.current = handle;
  useEffect(() => {
    const onCommand = (event: Event) => latest.current((event as CustomEvent<WatchCommand>).detail);
    window.addEventListener(WATCH_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(WATCH_COMMAND_EVENT, onCommand);
  }, []);
}
