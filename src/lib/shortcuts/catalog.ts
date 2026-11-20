import type { StringKey } from "../i18n/index";
import { MUSIC_COMMANDS, MUSIC_DOCK_COMMANDS } from "../musicPlayerKeys";
import { SHORTS_COMMANDS } from "../shortsKeys";
import { TAB_COMMANDS } from "../tabs/tabShortcuts";
import { VIDEO_COMMANDS } from "../videoPlayerKeys";
import { APP_COMMANDS } from "./appCommands";
import { CARD_COMMANDS } from "./cardCommands";
import type { ShortcutCommand, ShortcutScope } from "./command";

export interface ShortcutGroup {
  scope: ShortcutScope;
  title: StringKey;
  commands: readonly ShortcutCommand<unknown>[];
}

/** Every key in the app, in the order the key list shows them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { scope: "app", title: "keyboard_shortcuts_app", commands: APP_COMMANDS },
  { scope: "tabs", title: "keyboard_shortcuts_tabs", commands: TAB_COMMANDS },
  { scope: "cards", title: "keyboard_shortcuts_cards", commands: CARD_COMMANDS },
  { scope: "video", title: "keyboard_shortcuts_video", commands: VIDEO_COMMANDS },
  { scope: "music", title: "keyboard_shortcuts_music", commands: MUSIC_COMMANDS },
  { scope: "dock", title: "keyboard_shortcuts_music_bar", commands: MUSIC_DOCK_COMMANDS },
  { scope: "shorts", title: "keyboard_shortcuts_shorts", commands: SHORTS_COMMANDS },
];
