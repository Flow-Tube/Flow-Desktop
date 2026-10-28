import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { RailTooltip } from './RailTooltip';
import { wantsBackgroundTab } from '../../lib/clickIntent';

type SidebarItemProps = {
  icon: ReactNode;
  activeIcon?: ReactNode;
  label: string;
  isActive?: boolean;
  to?: string;
  end?: boolean;
  onClick?: () => void;
  rightElement?: ReactNode;
  /** Icon only, with the label as a tooltip. */
  collapsed?: boolean;
  /** Middle-click or Cmd/Ctrl-click on a link: open its page in a background tab. */
  onOpenInNewTab?: (to: string) => void;
};

const baseClasses =
  'relative mx-2 flex h-10 shrink-0 cursor-pointer items-center rounded-full text-sm transition-colors duration-200 ease-out';
const idleClasses = 'text-chrome-neutral-300 hover:bg-surface-container-low hover:text-chrome-neutral-100';
const activeClasses = 'bg-surface-container-high font-medium text-chrome-neutral-100';

function ItemContent({ icon, label, active, rightElement }: { icon: ReactNode; label: string; active: boolean; rightElement?: ReactNode }) {
  return (
    <>
      <span className={`grid w-14 shrink-0 place-items-center ${active ? 'text-[var(--color-primary)]' : ''}`}>
        {icon}
      </span>
      <span className="sidebar-label min-w-0 flex-1 truncate pr-3 text-left">{label}</span>
      {rightElement && <span className="sidebar-label ml-auto shrink-0 pr-3">{rightElement}</span>}
    </>
  );
}

export function SidebarItem({
  icon,
  activeIcon,
  label,
  isActive,
  to,
  end,
  onClick,
  rightElement,
  collapsed = false,
  onOpenInNewTab,
}: SidebarItemProps) {
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);
  const tooltipHandlers = collapsed
    ? {
      'aria-label': label,
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => setTooltipAnchor(event.currentTarget.getBoundingClientRect()),
      onMouseLeave: () => setTooltipAnchor(null),
      onFocus: (event: React.FocusEvent<HTMLElement>) => setTooltipAnchor(event.currentTarget.getBoundingClientRect()),
      onBlur: () => setTooltipAnchor(null),
    }
    : {};
  const tooltip = collapsed && tooltipAnchor ? <RailTooltip label={label} anchor={tooltipAnchor} /> : null;

  if (to) {
    return (
      <>
        <NavLink
          to={to}
          end={end}
          onClick={(event) => {
            setTooltipAnchor(null);
            if (onOpenInNewTab && wantsBackgroundTab(event)) {
              event.preventDefault();
              onOpenInNewTab(to);
              return;
            }
            onClick?.();
          }}
          onMouseDown={(event) => {
            if (onOpenInNewTab && event.button === 1) event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (!onOpenInNewTab || event.button !== 1) return;
            event.preventDefault();
            onOpenInNewTab(to);
          }}
          className={({ isActive: navActive }) => `${baseClasses} ${(isActive ?? navActive) ? activeClasses : idleClasses}`}
          {...tooltipHandlers}
        >
          {({ isActive: navActive }) => {
            const active = isActive ?? navActive;
            return <ItemContent icon={active ? (activeIcon ?? icon) : icon} label={label} active={active} rightElement={rightElement} />;
          }}
        </NavLink>
        {tooltip}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} ${isActive ? activeClasses : idleClasses}`}
        {...tooltipHandlers}
      >
        <ItemContent icon={isActive ? (activeIcon ?? icon) : icon} label={label} active={!!isActive} rightElement={rightElement} />
      </button>
      {tooltip}
    </>
  );
}
