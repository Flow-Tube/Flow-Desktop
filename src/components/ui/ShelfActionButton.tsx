import { ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface ShelfActionButtonProps {
  label: string;
  onClick: () => void;
}

/** The tonal "View all" pill at the end of a shelf header, so every shelf's way out looks the same. */
export function ShelfActionButton({ label, onClick }: ShelfActionButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="shrink-0 gap-1 px-4 text-sm focus-visible:ring-2 focus-visible:ring-primary"
    >
      {label}
      <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
    </Button>
  );
}
