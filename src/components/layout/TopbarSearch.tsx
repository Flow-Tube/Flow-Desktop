import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, X } from 'lucide-react';
import { SearchSuggestionsPanel, suggestionOptionId } from '../search/SearchSuggestionsPanel';
import { resolveChannelId } from '../../lib/api/youtube';
import { getString } from '../../lib/i18n/index';
import { IS_MACOS_RUNTIME } from '../../lib/platform';
import { buildSuggestionColumns, type SuggestionRow } from '../../lib/searchSuggestions';
import { SETTINGS } from '../../lib/settings/schema';
import { prefetchStreamInfo } from '../../lib/streamResolution';
import { useSearchSuggestions } from '../../lib/useSearchSuggestions';
import { parseYoutubeUrl, routeForYoutubeUrl } from '../../lib/youtubeUrl';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import { useMusicHiddenFilter } from '../../store/useMusicActionsStore';
import { useMusicPlayerStore } from '../../store/useMusicPlayerStore';
import { useSearchHistoryStore } from '../../store/useSearchHistoryStore';
import { useUiStore } from '../../store/useUiStore';

const SHORTCUT_LABEL = IS_MACOS_RUNTIME ? '⌘K' : 'Ctrl K';

export function TopbarSearch() {
  const navigate = useNavigate();
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const region = useAppSettingsStore((s) => s.values[SETTINGS.TRENDING_REGION]);
  const history = useSearchHistoryStore((s) => s.entries);
  const recordSearch = useSearchHistoryStore((s) => s.record);
  const removeSearch = useSearchHistoryStore((s) => s.remove);
  const clearHistory = useSearchHistoryStore((s) => s.clear);
  const playQueue = useMusicPlayerStore((s) => s.playQueue);
  const isHiddenSong = useMusicHiddenFilter();

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { suggestions, musicItems } = useSearchSuggestions(text, region);
  const columns = useMemo(
    () => buildSuggestionColumns({ query: text, history, suggestions, musicItems, isHiddenSong }),
    [text, history, suggestions, musicItems, isHiddenSong],
  );
  const rows = useMemo(() => [...columns.main, ...columns.side], [columns]);
  const panelVisible = open && rows.length > 0;

  // A changed row set invalidates whatever row the keyboard was on.
  useEffect(() => setActiveKey(null), [rows]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onShortcut);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onShortcut);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setActiveKey(null);
    inputRef.current?.blur();
  };

  const runTextSearch = (query: string) => {
    recordSearch(query);
    setText(query);
    setSearchQuery(query);
    close();
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const pick = (row: SuggestionRow) => {
    if (row.kind === 'history') return runTextSearch(row.query);
    if (row.kind === 'query') return runTextSearch(row.text);
    recordSearch(text);
    close();
    const item = row.item;
    switch (item.type) {
      case 'song':
        void playQueue([item], 0);
        return;
      case 'artist':
        navigate(item.isProfile ? `/channel/${item.id}` : `/music/artist/${item.id}`);
        return;
      case 'album':
        navigate(`/music/album/${item.browseId}`);
        return;
      case 'playlist':
        navigate(`/music/playlist/${item.id}`);
    }
  };

  const fill = (value: string) => {
    setText(value);
    setOpen(true);
    inputRef.current?.focus();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = text.trim();
    if (!query || resolving) return;

    // A pasted YouTube / YT-Music URL opens the target directly instead of searching.
    const parsed = parseYoutubeUrl(query);
    if (parsed) {
      const route = routeForYoutubeUrl(parsed);
      if (route) {
        if (parsed.kind === 'video') prefetchStreamInfo(parsed.videoId);
        close();
        navigate(route);
        return;
      }
      if (parsed.kind === 'resolveChannel') {
        // Handle / custom URLs have no channel id; the backend resolves it.
        setResolving(true);
        try {
          const channelId = await resolveChannelId(parsed.url);
          close();
          navigate(parsed.music ? `/music/artist/${channelId}` : `/channel/${channelId}`);
        } catch {
          runTextSearch(parsed.query || query);
        } finally {
          setResolving(false);
        }
        return;
      }
    }
    runTextSearch(query);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (panelVisible) {
        setOpen(false);
        setActiveKey(null);
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (!panelVisible) return;

    const index = rows.findIndex((row) => row.key === activeKey);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length;
      setActiveKey(rows[next]?.key ?? null);
      return;
    }
    const active = rows[index];
    if (!active) return;
    // Enter on a highlighted row runs it; otherwise the form submits what was typed.
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(active);
    } else if (event.key === 'Delete' && event.shiftKey && active.kind === 'history') {
      event.preventDefault();
      removeSearch(active.query);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        onSubmit={submit}
        role="search"
        className={`flex h-10 w-full items-center gap-2 rounded-full border pl-1.5 pr-2 transition-colors duration-200 ease-out ${
          panelVisible
            ? 'border-chrome-neutral-700 bg-surface-container'
            : 'border-chrome-neutral-800 bg-surface-container-low hover:border-chrome-neutral-700 focus-within:border-chrome-neutral-700 focus-within:bg-surface-container'
        }`}
      >
        <button
          type="submit"
          disabled={resolving}
          aria-label={getString('search_submit')}
          title={getString('search_submit')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100 disabled:opacity-70"
        >
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
        <input
          ref={inputRef}
          type="text"
          placeholder={getString('search_placeholder')}
          value={text}
          role="combobox"
          aria-expanded={panelVisible}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={activeKey ? suggestionOptionId(activeKey) : undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-chrome-neutral-100 outline-none placeholder:text-chrome-neutral-500"
        />
        {text ? (
          <button
            type="button"
            aria-label={getString('search_clear')}
            title={getString('search_clear')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => fill('')}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-highest hover:text-chrome-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded-md border border-chrome-neutral-700 px-1.5 py-0.5 font-sans text-[11px] font-medium text-chrome-neutral-500 lg:block">
            {SHORTCUT_LABEL}
          </kbd>
        )}
      </form>

      {panelVisible ? (
        <SearchSuggestionsPanel
          columns={columns}
          query={text}
          activeKey={activeKey}
          onHover={setActiveKey}
          onPick={pick}
          onFill={fill}
          onRemoveHistory={removeSearch}
          onClearHistory={clearHistory}
        />
      ) : null}
    </div>
  );
}
