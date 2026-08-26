import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, HatGlasses, Loader2, Menu, Search, Settings } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useAppSettingsStore } from '../../store/useAppSettingsStore';
import Logo from '../common/Logo';
import { IconButton } from '../ui/IconButton';
import { getSearchSuggestions, resolveChannelId } from '../../lib/api/youtube';
import { parseYoutubeUrl } from '../../lib/youtubeUrl';
import { prefetchStreamInfo } from '../../lib/streamResolution';
import { SETTINGS } from '../../lib/settings/schema';
import { getString } from '../../lib/i18n/index';
import { toggleDeepFlow } from '../../lib/deepFlow';
import { NotificationsBell } from '../notifications/NotificationsBell';

export function Topbar() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const toggleWatchSidebar = useUiStore((s) => s.toggleWatchSidebar);
  const setSearchQuery = useUiStore((s) => s.setSearchQuery);
  const [localSearch, setLocalSearch] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [resolving, setResolving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const suggestionRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const showAppLogo = useAppSettingsStore((state) => state.values[SETTINGS.SHOW_APP_LOGO_ICON] !== 'false');
  const deepFlowActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_FLOW_ACTIVE] === 'true');

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setShowSuggestions(true);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const query = localSearch.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    // Responses can land out of order, and clearing the timeout does not cancel a
    // request already in flight. Without this guard a slow reply for an earlier
    // keystroke overwrites the current one, which reads as suggestions that have
    // nothing to do with what was typed.
    let current = true;

    const delay = setTimeout(async () => {
      try {
        const results = await getSearchSuggestions(query);
        if (!current) return;
        setSuggestions(results.slice(0, 8));
      } catch (error) {
        console.warn("Suggestions error", error);
        // Leaving the previous query's results on screen is worse than none.
        if (current) setSuggestions([]);
      }
    }, 250);

    return () => {
      current = false;
      clearTimeout(delay);
    };
  }, [localSearch]);

  // A changed result set invalidates whatever row the keyboard was on.
  useEffect(() => setActiveSuggestion(-1), [suggestions]);

  const commitSuggestion = (suggestion: string) => {
    setLocalSearch(suggestion);
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    navigate(`/search?q=${encodeURIComponent(suggestion)}`);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
      return;
    }
    if (!showSuggestions || suggestions.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveSuggestion((current) => {
        const next = current + step;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }

    // Enter on a highlighted row runs that suggestion; otherwise the form submits.
    if (event.key === "Enter" && activeSuggestion >= 0) {
      const picked = suggestions[activeSuggestion];
      if (picked) {
        event.preventDefault();
        commitSuggestion(picked);
      }
    }
  };

  const runTextSearch = (query: string) => {
    setSearchQuery(query);
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = localSearch.trim();
    if (!query || resolving) return;
    setShowSuggestions(false);

    // A pasted YouTube / YT-Music URL opens the target directly instead of searching.
    const parsed = parseYoutubeUrl(query);
    if (parsed) {
      switch (parsed.kind) {
        case 'video':
          prefetchStreamInfo(parsed.videoId);
          navigate(`/watch/${parsed.videoId}`);
          return;
        case 'playlist':
          navigate(`/playlist/${parsed.playlistId}`);
          return;
        case 'musicPlaylist':
          navigate(`/music/playlist/${parsed.playlistId}`);
          return;
        case 'musicAlbum':
          navigate(`/music/album/${parsed.browseId}`);
          return;
        case 'channel':
          navigate(`/channel/${parsed.channelId}`);
          return;
        case 'musicArtist':
          navigate(`/music/artist/${parsed.channelId}`);
          return;
        case 'resolveChannel': {
          // Handle / custom URLs have no channel id — resolve it via the backend.
          setResolving(true);
          try {
            const channelId = await resolveChannelId(parsed.url);
            navigate(parsed.music ? `/music/artist/${channelId}` : `/channel/${channelId}`);
          } catch {
            runTextSearch(parsed.query || query); // couldn't resolve — search instead
          } finally {
            setResolving(false);
          }
          return;
        }
      }
    }

    runTextSearch(query);
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-transparent bg-background px-3">
      {/* Left */}
      <div className="flex min-w-0 items-center gap-2">
        <IconButton onClick={(location.pathname.startsWith('/watch/') || location.pathname.startsWith('/settings')) ? toggleWatchSidebar : toggleSidebar}>
          <Menu />
        </IconButton>
        {showAppLogo && (
          <div className="cursor-pointer" onClick={() => navigate('/')}>
            <Logo size={36} showText={true} />
          </div>
        )}
        <div className="hidden ml-1 items-center sm:flex">
          <IconButton
            title="Back"
            onClick={() => navigate(-1)}
            className="text-chrome-zinc-300 hover:text-chrome-zinc-100"
          >
            <ArrowLeft />
          </IconButton>
          <IconButton
            title="Forward"
            onClick={() => navigate(1)}
            className="text-chrome-zinc-300 hover:text-chrome-zinc-100"
          >
            <ArrowRight />
          </IconButton>
        </div>
      </div>

      {/* Center - Search */}
      <div className="relative flex max-w-[720px] flex-1 items-center justify-center px-4 md:px-8" ref={suggestionRef}>
        <form 
          onSubmit={handleSearch} 
          className="flex h-10 w-full items-center overflow-hidden rounded-full border border-chrome-zinc-800 bg-chrome-searchbar transition-colors focus-within:border-chrome-zinc-500"
        >
          <div className="flex min-w-0 flex-1 items-center px-4">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search"
              value={localSearch}
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="search-suggestions"
              aria-activedescendant={activeSuggestion >= 0 ? `search-suggestion-${activeSuggestion}` : undefined}
              autoComplete="off"
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleSearchKeyDown}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setShowSuggestions(true);
              }}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-chrome-zinc-100 outline-none placeholder:text-chrome-zinc-500"
            />
            <kbd className="ml-3 hidden rounded-md border border-chrome-zinc-700 px-2 py-0.5 text-[11px] font-semibold text-chrome-zinc-500 lg:block">
              Ctrl K
            </kbd>
          </div>
          <button
            type="submit"
            disabled={resolving}
            className="flex h-10 w-14 items-center justify-center border-l border-chrome-zinc-800 bg-chrome-zinc-900 text-chrome-zinc-200 transition-colors hover:bg-chrome-zinc-800 disabled:opacity-70"
            title="Search"
          >
            {resolving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </button>
        </form>

        {/* Suggestion Dropdown overlay */}
        {showSuggestions && suggestions.length > 0 && (
          <div
            id="search-suggestions"
            role="listbox"
            className="absolute left-4 right-4 top-[48px] z-50 max-h-[60vh] overflow-y-auto overscroll-contain rounded-2xl border border-chrome-zinc-800 bg-chrome-dropdown py-1 scrollbar-none md:left-8 md:right-8"
          >
            {suggestions.map((item, index) => (
              <div
                key={item}
                id={`search-suggestion-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                // Keep focus in the input so the caret and keyboard stay live.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={() => commitSuggestion(item)}
                className={`flex cursor-pointer items-center gap-3 px-5 py-3 text-sm font-medium text-chrome-zinc-200 transition-colors ${
                  index === activeSuggestion ? "bg-chrome-zinc-800" : ""
                }`}
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-chrome-zinc-500" />
                <span className="min-w-0 truncate">{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <NotificationsBell />
        <IconButton
          onClick={() => {
            void toggleDeepFlow();
          }}
          title={getString(deepFlowActive ? 'deep_flow_topbar_disable' : 'deep_flow_topbar_enable')}
          aria-pressed={deepFlowActive}
          className={deepFlowActive ? 'deep-flow-topbar-active' : undefined}
        >
          <HatGlasses />
        </IconButton>
        <IconButton onClick={() => navigate('/settings')} title="Settings">
          <Settings />
        </IconButton>
      </div>
    </header>
  );
}
