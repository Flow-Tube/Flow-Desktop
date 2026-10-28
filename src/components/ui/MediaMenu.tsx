import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, Info } from "lucide-react";
import { AnchoredPortalMenu, type MenuAnchor } from "./AnchoredPortalMenu";
import { moveMenuFocus } from "./menuFocus";

/** Where an action sits: a tile in the top row, or a row in one of the groups below it. */
export type MediaMenuGroup = "quick" | "library" | "go" | "feed";

export interface MediaMenuAction {
  id: string;
  label: string;
  /** A short label for the tile, when the action is a quick action. */
  tileLabel?: string;
  icon: ReactNode;
  onSelect: () => void | Promise<void>;
  group?: MediaMenuGroup;
  /** Removes or hides something. */
  danger?: boolean;
  /** Already on, such as a video saved to Watch Later. */
  active?: boolean;
}

export interface MediaMenuHeader {
  title: string;
  subtitle?: string | null;
  image?: string | null;
  imageShape?: "landscape" | "square" | "portrait";
}

const GROUP_ORDER: MediaMenuGroup[] = ["library", "go", "feed"];
const MAX_TILES = 4;

const posterSizes = {
  landscape: "h-9 w-16",
  square: "h-10 w-10",
  portrait: "h-12 w-7",
};

type MediaMenuProps = {
  anchor: MenuAnchor;
  onClose: () => void;
  actions: MediaMenuAction[];
  header?: MediaMenuHeader;
  note?: { title: string; body: ReactNode } | null;
  className?: string;
};


export function MediaMenu({ anchor, onClose, actions, header, note, className = "z-50" }: MediaMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tiles = actions.filter((action) => action.group === "quick").slice(0, MAX_TILES);
  const groups = GROUP_ORDER
    .map((group) => actions.filter((action) => (action.group ?? "library") === group))
    .filter((group) => group.length > 0);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const select = (action: MediaMenuAction) => {
    onClose();
    void action.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (moveMenuFocus(event.currentTarget, event.key)) event.preventDefault();
  };

  return (
    <AnchoredPortalMenu anchor={anchor} onClose={onClose} className={className}>
      <div
        ref={panelRef}
        role="menu"
        tabIndex={-1}
        aria-label={header?.title}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="w-72 overflow-hidden rounded-lg border border-chrome-neutral-800 bg-surface-container-high p-1.5 text-sm text-chrome-neutral-200 outline-none"
      >
        {header ? (
          <div className="flex items-center gap-3 px-1.5 pb-2.5 pt-1">
            {header.image ? (
              <img
                src={header.image}
                alt=""
                className={`shrink-0 rounded-md bg-surface-container object-cover ${posterSizes[header.imageShape ?? "landscape"]}`}
              />
            ) : null}
            <div className="min-w-0">
              <p className="line-clamp-2 font-medium leading-snug text-chrome-neutral-100">{header.title}</p>
              {header.subtitle ? <p className="mt-0.5 truncate text-xs text-chrome-neutral-400">{header.subtitle}</p> : null}
            </div>
          </div>
        ) : null}

        {tiles.length > 0 ? (
          <div className={`grid gap-1 ${tiles.length >= 4 ? "grid-cols-4" : tiles.length === 3 ? "grid-cols-3" : "grid-cols-2"} ${header ? "border-t border-chrome-neutral-800 pt-1.5" : ""}`}>
            {tiles.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                title={action.label}
                onClick={() => select(action)}
                className="flex flex-col items-center gap-1.5 rounded-md px-1 pb-2 pt-2.5 text-xs text-chrome-neutral-200 transition-colors duration-150 ease-out hover:bg-surface-container-highest focus-visible:bg-surface-container-highest focus-visible:outline-none"
              >
                <span className={`grid h-5 w-5 place-items-center ${action.active ? "text-[var(--color-primary)]" : "text-chrome-neutral-300"}`}>
                  {action.icon}
                </span>
                <span className="line-clamp-1 max-w-full">{action.tileLabel ?? action.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        {groups.map((group, groupIndex) => (
          <Fragment key={group[0]?.group ?? groupIndex}>
            {groupIndex > 0 || tiles.length > 0 || header ? (
              <div role="separator" className="mx-1.5 my-1.5 border-t border-chrome-neutral-800" />
            ) : null}
            {group.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                onClick={() => select(action)}
                className={`flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left transition-colors duration-150 ease-out hover:bg-surface-container-highest focus-visible:bg-surface-container-highest focus-visible:outline-none ${
                  action.danger ? "text-chrome-red-400" : ""
                }`}
              >
                <span className={`grid h-4 w-4 shrink-0 place-items-center ${action.danger ? "" : "text-chrome-neutral-400"}`}>
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.active ? <Check size={14} className="shrink-0 text-[var(--color-primary)]" /> : null}
              </button>
            ))}
          </Fragment>
        ))}

        {note ? (
          <div className="mx-0.5 mt-1.5 flex items-start gap-2.5 rounded-md bg-surface-container px-2.5 py-2 text-xs text-chrome-neutral-400">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="block font-medium text-chrome-neutral-300">{note.title}</span>
              {note.body}
            </span>
          </div>
        ) : null}
      </div>
    </AnchoredPortalMenu>
  );
}
