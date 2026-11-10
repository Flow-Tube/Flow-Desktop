import { useMemo } from "react";

import { useNewSettingsStore } from "../../store/useNewSettingsStore";
import { getString, type StringKey } from "../i18n/index";

/** The titles, as shown, of the settings that get a dot. */
export function useNewSettingLabels(): ReadonlySet<string> {
  const titles = useNewSettingsStore((state) => state.titles);
  return useMemo(() => new Set([...titles].map((title) => getString(title as StringKey))), [titles]);
}
