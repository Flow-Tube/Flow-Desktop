import { useRef } from "react";
import { ArrowUpLeft, Clock, Link2, Search, TriangleAlert, X } from "lucide-react";
import { filterSummary } from "../../lib/searchFilterOptions";
import { IS_MACOS_RUNTIME } from "../../lib/platform";
import { getString } from "../../lib/i18n/index";
import {
  musicItemImage,
  linkLabel,
  musicItemShape,
  musicItemSubtitle,
  splitCompletion,
  type SuggestionColumns,
  type SuggestionRow,
} from "../../lib/searchSuggestions";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { useExitGhost } from "../../lib/useExitGhost";

export const suggestionOptionId = (key: string) => `search-suggestion-${key.replace(/[^\w-]/g, "_")}`;

type PanelProps = {
  columns: SuggestionColumns;
  query: string;
  activeKey: string | null;
  onHover: (key: string) => void;
  onPick: (row: SuggestionRow) => void;
  onFill: (text: string) => void;
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
  /** The box holds a web address Flow can't open. */
  unsupportedLink: boolean;
};

const shapeClasses = {
  circle: "h-10 w-10 rounded-full",
  square: "h-10 w-10 rounded-md",
  wide: "h-10 w-[71px] rounded-md",
};

function Picture({ src, shape }: { src: string | null; shape: keyof typeof shapeClasses }) {
  const proxied = useProxiedImageUrl(src ? upgradeMusicImageUrl(src, 120) ?? src : null);
  return proxied
    ? <img src={proxied} alt="" loading="lazy" className={`shrink-0 bg-surface-container object-cover ${shapeClasses[shape]}`} />
    : <span className={`shrink-0 bg-surface-container ${shapeClasses[shape]}`} />;
}

function Completion({ text, query }: { text: string; query: string }) {
  const { typed, completion } = splitCompletion(text, query);
  return (
    <span className="min-w-0 truncate">
      <span className="text-chrome-neutral-300">{typed}</span>
      <span className="font-semibold text-chrome-neutral-100">{completion}</span>
    </span>
  );
}

const rowBase = "group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-sm transition-colors duration-150 ease-out";

export function SearchSuggestionsPanel({
  columns,
  query,
  activeKey,
  onHover,
  onPick,
  onFill,
  onRemoveHistory,
  onClearHistory,
  unsupportedLink,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useExitGhost(panelRef);
  const isEmptyQuery = !query.trim();
  const hasSide = columns.side.length > 0;

  const rowProps = (row: SuggestionRow) => ({
    id: suggestionOptionId(row.key),
    role: "option" as const,
    "aria-selected": row.key === activeKey,
    // Keep focus in the input so the caret and keyboard stay live.
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseEnter: () => onHover(row.key),
    onClick: () => onPick(row),
  });
  const activeClass = (row: SuggestionRow) => (row.key === activeKey ? "bg-surface-container-highest" : "");

  const renderMain = (row: SuggestionRow) => {
    if (row.kind === "more") {
      return (
        <div key={row.key} {...rowProps(row)} className={`${rowBase} h-10 font-medium text-chrome-neutral-400 ${activeClass(row)}`}>
          <span className="w-4 shrink-0" />
          {getString("search_history_show_all", row.count)}
        </div>
      );
    }
    if (row.kind === "link") {
      return (
        <div key={row.key} {...rowProps(row)} className={`${rowBase} py-1.5 ${activeClass(row)}`}>
          <Link2 className="h-4 w-4 shrink-0 text-chrome-neutral-500" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold text-chrome-neutral-100">{linkLabel(row.parsed)}</span>
            <span dir="ltr" className="truncate text-start text-xs text-chrome-neutral-400">{query.trim()}</span>
          </span>
          <kbd className="shrink-0 rounded-md border border-chrome-neutral-700 px-1.5 py-0.5 font-sans text-[11px] text-chrome-neutral-500">↵</kbd>
        </div>
      );
    }
    if (row.kind === "history") {
      const summary = row.filters ? filterSummary(row.filters) : "";
      return (
        <div key={row.key} {...rowProps(row)} className={`${rowBase} ${summary ? "py-1.5" : "h-10"} ${activeClass(row)}`}>
          <Clock className="h-4 w-4 shrink-0 text-chrome-neutral-500" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0"><Completion text={row.query} query={query} /></span>
            {summary ? <span className="truncate text-xs text-chrome-neutral-400">{summary}</span> : null}
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-label={getString("search_remove_history")}
            title={getString("search_remove_history")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveHistory(row.query);
            }}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-chrome-neutral-500 transition-opacity hover:bg-surface-container hover:text-chrome-neutral-200 ${
              row.key === activeKey ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    if (row.kind !== "query") return null;
    const entity = row.entity;
    return (
      <div key={row.key} {...rowProps(row)} className={`${rowBase} ${entity ? "py-1.5" : "h-10"} ${activeClass(row)}`}>
        {entity?.image ? (
          <img src={entity.image} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-full bg-surface-container object-cover" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-chrome-neutral-500" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <Completion text={row.text} query={query} />
          {entity?.description ? <span dir="auto" className="truncate text-xs text-chrome-neutral-400">{entity.description}</span> : null}
        </span>
        <button
          type="button"
          tabIndex={-1}
          aria-label={getString("search_fill")}
          title={getString("search_fill")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onFill(row.text);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-chrome-neutral-500 hover:bg-surface-container hover:text-chrome-neutral-200"
        >
          <ArrowUpLeft className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const renderSide = (row: SuggestionRow) => {
    if (row.kind !== "music") return null;
    const item = row.item;
    return (
      <div key={row.key} {...rowProps(row)} className={`${rowBase} py-1.5 ${activeClass(row)}`}>
        <Picture src={musicItemImage(item)} shape={musicItemShape(item)} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate font-medium text-chrome-neutral-100">{item.title}</span>
          <span className="truncate text-xs text-chrome-neutral-400">{musicItemSubtitle(item)}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      id="search-suggestions"
      role="listbox"
      className={`animate-menu-in absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-1.5 ${
        hasSide ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-1.5" : ""
      }`}
    >
      <div className="min-w-0">
        {unsupportedLink ? (
          <p className="flex items-start gap-3 px-3 py-2.5 text-sm text-chrome-neutral-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-chrome-neutral-500" />
            {getString("search_link_unsupported")}
          </p>
        ) : null}
        {isEmptyQuery ? (
          <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
            <span className="text-xs font-medium text-chrome-neutral-400">{getString("search_recent")}</span>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClearHistory}
              className="rounded-full px-2 py-0.5 text-xs font-medium text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
            >
              {getString("search_clear_history")}
            </button>
          </div>
        ) : null}
        {columns.main.map(renderMain)}
      </div>
      {hasSide ? (
        <div className="min-w-0 border-t border-chrome-neutral-800 pt-1.5 md:border-s md:border-t-0 md:ps-1.5 md:pt-0">
          <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-chrome-neutral-400">{getString("search_music_section")}</p>
          {columns.side.map(renderSide)}
        </div>
      ) : null}
      <KeyHints canRemove={columns.main.some((row) => row.kind === "history")} />
    </div>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="me-1 rounded-md border border-chrome-neutral-700 px-1.5 py-px font-sans text-[11px] font-medium text-chrome-neutral-500">
      {children}
    </kbd>
  );
}

/** The keys the list answers to, along its foot. */
function KeyHints({ canRemove }: { canRemove: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="col-span-full mt-1 hidden items-center gap-4 border-t border-chrome-neutral-800 px-3 pb-1 pt-2 text-[11px] text-chrome-neutral-500 md:flex"
    >
      <span><Key>↑</Key><Key>↓</Key>{getString("search_keys_move")}</span>
      <span><Key>↵</Key>{getString("search_keys_search")}</span>
      <span><Key>Tab</Key>{getString("search_keys_fill")}</span>
      {canRemove ? <span><Key>{IS_MACOS_RUNTIME ? "⇧ ⌦" : "Shift Del"}</Key>{getString("search_keys_remove")}</span> : null}
      <span className="ms-auto"><Key>Esc</Key>{getString("search_keys_close")}</span>
    </div>
  );
}
