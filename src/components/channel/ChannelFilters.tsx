import React from "react";
import { Chip } from "../ui/Chip";
import { FilterSelect } from "../ui/FilterSelect";
import type { ChannelFilterGroup, ChannelFilterOption } from "../../types/video";

interface ChannelFiltersProps {
  groups: ChannelFilterGroup[];
  onSelect: (option: ChannelFilterOption) => void;
}

/** A tab's filters as the channel sends them: chip rows on the left, sort menus on the right. */
export const ChannelFilters: React.FC<ChannelFiltersProps> = ({ groups, onSelect }) => {
  const chips = groups.filter((group) => !group.isDropdown);
  const menus = groups.filter((group) => group.isDropdown && group.options.length > 1);
  if (chips.length === 0 && menus.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.flatMap((group) =>
          group.options.map((option) => (
            <Chip
              key={`${option.label}:${option.continuation ?? option.params ?? ""}`}
              active={option.selected}
              onClick={() => !option.selected && onSelect(option)}
            >
              {option.label}
            </Chip>
          )),
        )}
      </div>
      <div className="flex items-center gap-2">
        {menus.map((group, groupIndex) => {
          const selected = Math.max(
            0,
            group.options.findIndex((option) => option.selected),
          );
          return (
            <FilterSelect
              key={groupIndex}
              label={group.title ?? undefined}
              value={String(selected)}
              options={group.options.map((option, index) => ({ value: String(index), label: option.label }))}
              onChange={(value) => {
                const option = group.options[Number(value)];
                if (option && !option.selected) onSelect(option);
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
