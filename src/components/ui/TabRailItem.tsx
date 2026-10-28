import { useState, type MouseEvent, type ReactNode } from 'react';
import { Volume2, X } from 'lucide-react';
import { RailTooltip } from './RailTooltip';

type TabRailItemProps = {
  label: string;
  icon: ReactNode;
  active: boolean;
  /** This tab's video is the one in the player. */
  playing: boolean;
  /** Icon only, with the label as a tooltip. */
  collapsed: boolean;
  closeLabel: string;
  playingLabel: string;
  onSelect: () => void;
  onClose: () => void;
  onOpenMenu: (point: { x: number; y: number }) => void;
};

/** One open tab in the side rail, shaped like the rail's other rows. */
export function TabRailItem({
  label,
  icon,
  active,
  playing,
  collapsed,
  closeLabel,
  playingLabel,
  onSelect,
  onClose,
  onOpenMenu,
}: TabRailItemProps) {
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);

  const onAuxClick = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose();
  };

  return (
    <div
      className={`group relative mx-2 flex h-10 shrink-0 items-center rounded-full text-sm transition-colors duration-200 ease-out ${
        active
          ? 'bg-surface-container-high font-medium text-chrome-neutral-100'
          : 'text-chrome-neutral-300 hover:bg-surface-container-low hover:text-chrome-neutral-100'
      }`}
      onAuxClick={onAuxClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={() => {
          setTooltipAnchor(null);
          onSelect();
        }}
        onMouseEnter={collapsed ? (event) => setTooltipAnchor(event.currentTarget.getBoundingClientRect()) : undefined}
        onMouseLeave={collapsed ? () => setTooltipAnchor(null) : undefined}
        onFocus={collapsed ? (event) => setTooltipAnchor(event.currentTarget.getBoundingClientRect()) : undefined}
        onBlur={collapsed ? () => setTooltipAnchor(null) : undefined}
        className="flex h-full min-w-0 flex-1 items-center rounded-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        <span className="relative grid w-14 shrink-0 place-items-center">
          {icon}
          {playing && (
            <span
              className="absolute -bottom-1 right-3 grid h-4 w-4 place-items-center rounded-full bg-background text-[var(--color-primary)]"
              aria-label={playingLabel}
              role="img"
            >
              <Volume2 className="h-3 w-3" />
            </span>
          )}
        </span>
        <span className="sidebar-label min-w-0 flex-1 truncate pr-10">{label}</span>
      </button>
      {!collapsed && (
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className="absolute right-1.5 grid h-7 w-7 place-items-center rounded-full text-chrome-neutral-400 opacity-0 transition-colors duration-200 ease-out hover:bg-surface-container-highest hover:text-chrome-neutral-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {collapsed && tooltipAnchor && <RailTooltip label={label} anchor={tooltipAnchor} />}
    </div>
  );
}
