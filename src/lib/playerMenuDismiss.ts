/*
  Which open player menu a press closes. The settings menu and the right-click menu
  are open one at a time, and any press outside the open one closes it. A press on
  the video itself is handled by the gesture layer, which also keeps that click from
  toggling playback.
*/

/** Marks a player menu's own surface; presses inside it never close it. */
export const PLAYER_MENU_ATTR = "data-player-menu";
/** Marks the control-bar buttons that open the settings menu and toggle it themselves. */
export const PLAYER_MENU_OWNER_ATTR = "data-player-menu-owner";
/** Marks the gesture layer over the video. */
export const PLAYER_VIDEO_LAYER_ATTR = "data-player-video-layer";

export type PlayerPress = "menu" | "owner" | "video" | "elsewhere";

export interface PlayerMenusOpen {
  settings: boolean;
  context: boolean;
}

export interface PlayerMenuDismissal {
  closeSettings: boolean;
  closeContext: boolean;
}

export function classifyPlayerPress(target: EventTarget | null): PlayerPress {
  if (!(target instanceof Element)) return "elsewhere";
  if (target.closest(`[${PLAYER_MENU_ATTR}]`)) return "menu";
  if (target.closest(`[${PLAYER_MENU_OWNER_ATTR}]`)) return "owner";
  if (target.closest(`[${PLAYER_VIDEO_LAYER_ATTR}]`)) return "video";
  return "elsewhere";
}

export function dismissForPress(press: PlayerPress, open: PlayerMenusOpen): PlayerMenuDismissal {
  switch (press) {
    case "menu":
      return { closeSettings: false, closeContext: false };
    case "owner":
      // The button switches or closes the settings menu on its own click.
      return { closeSettings: false, closeContext: open.context };
    case "video":
    case "elsewhere":
      return { closeSettings: open.settings, closeContext: open.context };
  }
}
