import { IS_MACOS_RUNTIME } from "./platform";

export interface ClickLike {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Middle-click, or Cmd-click on macOS and Ctrl-click elsewhere: open in a background tab, as in a browser. */
export function wantsBackgroundTab(event: ClickLike, isMac = IS_MACOS_RUNTIME): boolean {
  if (event.button === 1) return true;
  return event.button === 0 && (isMac ? event.metaKey : event.ctrlKey);
}
