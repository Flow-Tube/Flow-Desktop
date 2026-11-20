import { IS_MACOS_RUNTIME } from "../platform";
import { APP_COMMANDS } from "./appCommands";
import { useShortcutSettings } from "./bindings";
import { commandKeys } from "./command";
import { chordCaption } from "./format";

/** The first key that opens search, as the search box shows it ("⌘K"); null when search has none. */
export function useSearchShortcutCaption(): string | null {
  const { overrides } = useShortcutSettings();
  const search = APP_COMMANDS.find((command) => command.id === "app.search");
  const first = search ? commandKeys(search, IS_MACOS_RUNTIME, overrides)[0] : undefined;
  return first ? chordCaption(first, IS_MACOS_RUNTIME) : null;
}
