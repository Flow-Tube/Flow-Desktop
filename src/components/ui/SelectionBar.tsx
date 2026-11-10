import type { ReactNode } from "react";
import { getString } from "../../lib/i18n/index";
import { Button } from "./Button";

export interface SelectionAction {
  key: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}

interface SelectionBarProps {
  summary: string;
  hasSelection: boolean;
  allSelected: boolean;
  onToggleAll: () => void;
  onDone: () => void;
  actions: SelectionAction[];
}

/** Stands in for a list's toolbar while rows are being picked. */
export function SelectionBar({ summary, hasSelection, allSelected, onToggleAll, onDone, actions }: SelectionBarProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className="text-sm font-medium tabular-nums text-chrome-neutral-100">{summary}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onToggleAll}>
        {getString(allSelected ? "deselect_all" : "select_all")}
      </Button>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            type="button"
            size="sm"
            variant={action.destructive ? "destructive" : "secondary"}
            disabled={!hasSelection}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {getString("downloads_cancel_selection")}
        </Button>
      </div>
    </div>
  );
}
