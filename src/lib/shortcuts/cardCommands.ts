import { directionForKey, type CardDirection } from "../cardNavigation";
import type { ShortcutCommand } from "./command";

type CardCommand = ShortcutCommand<CardDirection | null>;

/**
 * Keys on a focused card. The arrows are read here; Enter and Cmd/Ctrl+Enter belong to each card
 * (`cardKeyboardProps`), and are listed so the key list shows them.
 */
export const CARD_COMMANDS: readonly CardCommand[] = [
  {
    id: "cards.move",
    scope: "cards",
    label: "keyboard_shortcut_cards_move",
    keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    fixed: true,
    action: (key) => directionForKey(key),
  },
  { id: "cards.open", scope: "cards", label: "keyboard_shortcut_cards_open", keys: ["Enter"], fixed: true, action: () => null },
  {
    id: "cards.open-in-tab",
    scope: "cards",
    label: "keyboard_shortcut_cards_open_in_tab",
    keys: ["Mod+Enter"],
    fixed: true,
    action: () => null,
  },
];
