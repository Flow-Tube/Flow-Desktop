import { createPortal } from "react-dom";

type RailTooltipProps = {
  label: string;
  anchor: DOMRect;
};

/** A label beside a rail icon. Drawn in a portal, since the rail clips anything wider than it. */
export function RailTooltip({ label, anchor }: RailTooltipProps) {
  return createPortal(
    <span
      role="tooltip"
      className="pointer-events-none fixed z-[110] -translate-y-1/2 whitespace-nowrap rounded-md bg-surface-container-highest px-2.5 py-1 text-xs font-medium text-chrome-neutral-100"
      style={{ left: anchor.right + 8, top: anchor.top + anchor.height / 2 }}
    >
      {label}
    </span>,
    document.body,
  );
}
