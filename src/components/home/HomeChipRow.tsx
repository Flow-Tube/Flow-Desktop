import { Chip } from "../ui/Chip";

export interface HomeChipOption {
  key: string;
  label: string;
}

interface HomeChipRowProps {
  chips: HomeChipOption[];
  selected: string;
  onSelect: (key: string) => void;
}

export function HomeChipRow({ chips, selected, onSelect }: HomeChipRowProps) {
  return (
    <div className="flex gap-2 overflow-x-auto">
      {chips.map((chip) => (
        <Chip key={chip.key} active={chip.key === selected} onClick={() => onSelect(chip.key)}>
          {chip.label}
        </Chip>
      ))}
    </div>
  );
}
