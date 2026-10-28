import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useExitGhost } from "../../../lib/useExitGhost";
import { PLAYER_MENU_ATTR } from "../../../lib/playerMenuDismiss";

export interface PlayerContextMenuItem {
  label: string;
  icon: ReactNode;
  action: () => void | Promise<void>;
}

const EDGE_PX = 8;

/**
 * The right-click menu, placed at the cursor once its real size is known. It grows
 * from the corner at the cursor and flips left or up when there is no room.
 */
export function PlayerContextMenu({
  at,
  groups,
  onSelect,
}: {
  /** The press point inside the player. */
  at: { x: number; y: number };
  groups: PlayerContextMenuItem[][];
  onSelect: (item: PlayerContextMenuItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: at.x, top: at.y, visibility: "hidden" });
  useExitGhost(ref);

  useLayoutEffect(() => {
    const menu = ref.current;
    const player = menu?.offsetParent;
    if (!menu || !(player instanceof HTMLElement)) return;
    const { offsetWidth: width, offsetHeight: height } = menu;
    const flipX = at.x + width > player.clientWidth - EDGE_PX;
    const flipY = at.y + height > player.clientHeight - EDGE_PX;
    const left = Math.max(EDGE_PX, flipX ? at.x - width : at.x);
    const top = Math.max(EDGE_PX, flipY ? at.y - height : at.y);
    setStyle({
      left,
      top,
      visibility: "visible",
      transformOrigin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
  }, [at.x, at.y]);

  return (
    <div
      ref={ref}
      {...{ [PLAYER_MENU_ATTR]: "" }}
      role="menu"
      style={style}
      className="animate-menu-in absolute z-50 w-[280px] overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover/95 p-1.5 text-chrome-white"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.label ?? index}>
          {index > 0 && <div role="separator" className="mx-1.5 my-1 border-t border-chrome-white/10" />}
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm font-medium text-chrome-zinc-100 transition-colors duration-200 ease-out hover:bg-chrome-white/10"
              onClick={() => onSelect(item)}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center text-chrome-zinc-300">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
