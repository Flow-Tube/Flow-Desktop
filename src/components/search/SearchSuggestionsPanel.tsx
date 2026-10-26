import { ArrowUpLeft, Clock, Search, X } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import {
  musicItemImage,
  musicItemShape,
  musicItemSubtitle,
  splitCompletion,
  type SuggestionColumns,
  type SuggestionRow,
} from "../../lib/searchSuggestions";
import { upgradeMusicImageUrl } from "../../lib/thumbnails";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";

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

const rowBase = "group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-150 ease-out";

export function SearchSuggestionsPanel({
  columns,
  query,
  activeKey,
  onHover,
  onPick,
  onFill,
  onRemoveHistory,
  onClearHistory,
}: PanelProps) {
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
    if (row.kind === "history") {
      return (
        <div key={row.key} {...rowProps(row)} className={`${rowBase} h-10 ${activeClass(row)}`}>
          <Clock className="h-4 w-4 shrink-0 text-chrome-neutral-500" />
          <span className="flex min-w-0 flex-1"><Completion text={row.query} query={query} /></span>
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
          {entity?.description ? <span className="truncate text-xs text-chrome-neutral-400">{entity.description}</span> : null}
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
          <span className="truncate font-medium text-chrome-neutral-100">{item.title}</span>
          <span className="truncate text-xs text-chrome-neutral-400">{musicItemSubtitle(item)}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      id="search-suggestions"
      role="listbox"
      className={`animate-fade-in absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-chrome-neutral-800 bg-surface-container-high p-1.5 scrollbar-none ${
        hasSide ? "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-1.5" : ""
      }`}
    >
      <div className="min-w-0">
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
        <div className="min-w-0 border-t border-chrome-neutral-800 pt-1.5 md:border-l md:border-t-0 md:pl-1.5 md:pt-0">
          <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-chrome-neutral-400">{getString("search_music_section")}</p>
          {columns.side.map(renderSide)}
        </div>
      ) : null}
    </div>
  );
}
