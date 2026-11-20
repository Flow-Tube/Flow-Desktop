import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { IS_MACOS_RUNTIME } from "../../../lib/platform";
import { NO_OVERRIDES, saveOverrides, useShortcutSettings } from "../../../lib/shortcuts/bindings";
import { SHORTCUT_GROUPS } from "../../../lib/shortcuts/catalog";
import { commandKeys } from "../../../lib/shortcuts/command";
import { chordCaption } from "../../../lib/shortcuts/format";
import { useConfirmStore } from "../../../store/useConfirmStore";
import { Button } from "../../ui/Button";
import { SearchInput } from "../../ui/SearchInput";
import { SettingsGroup } from "../SettingsGroup";
import { ShortcutEditRow } from "./ShortcutEditRow";

/** Every shortcut, grouped as in the key list, with a search over names and keys. */
export function ShortcutSettingsList() {
  const { overrides } = useShortcutSettings();
  const [query, setQuery] = useState("");
  const anyChanged = Object.keys(overrides).length > 0;

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return SHORTCUT_GROUPS.map((group) => ({
      ...group,
      commands: group.commands.filter((command) => {
        if (!needle) return true;
        const caps = commandKeys(command, IS_MACOS_RUNTIME, overrides).map((key) => chordCaption(key, IS_MACOS_RUNTIME));
        return [getString(command.label), ...caps].some((text) => text.toLocaleLowerCase().includes(needle));
      }),
    })).filter((group) => group.commands.length > 0);
  }, [overrides, query]);

  const resetAll = async () => {
    const confirmed = await useConfirmStore.getState().ask({
      title: getString("settings_shortcuts_reset_all_title"),
      message: getString("settings_shortcuts_reset_all_message"),
      confirmLabel: getString("settings_shortcuts_reset_all"),
      icon: RotateCcw,
    });
    if (confirmed) void saveOverrides(NO_OVERRIDES);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          containerClassName="flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={getString("settings_shortcuts_search")}
          aria-label={getString("settings_shortcuts_search")}
        />
        <Button variant="tonal" onClick={() => void resetAll()} disabled={!anyChanged}>
          {getString("settings_shortcuts_reset_all")}
        </Button>
      </div>
      <p className="px-1 text-xs text-chrome-neutral-400">
        {getString("keyboard_shortcuts_hint")} {getString("settings_shortcuts_edit_hint")}
      </p>
      {groups.map((group) => (
        <SettingsGroup key={group.scope} title={getString(group.title)}>
          {group.commands.map((command) => (
            <ShortcutEditRow key={command.id} command={command} overrides={overrides} />
          ))}
        </SettingsGroup>
      ))}
      {groups.length === 0 && (
        <p className="rounded-2xl bg-surface-row px-5 py-4 text-sm text-chrome-neutral-400">{getString("settings_shortcuts_no_match")}</p>
      )}
    </div>
  );
}
