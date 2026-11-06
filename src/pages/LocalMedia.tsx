import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Play, RefreshCw, Settings as SettingsIcon, Shuffle } from "lucide-react";

import { LocalContinueShelf } from "../components/localMedia/LocalContinueShelf";
import { LocalFileList } from "../components/localMedia/LocalFileList";
import { LocalFolderList } from "../components/localMedia/LocalFolderList";
import { LocalMediaFilterBar } from "../components/localMedia/LocalMediaFilterBar";
import {
  LocalEmpty,
  LocalLoadFailed,
  LocalLoading,
  LocalNoFolders,
  LocalNoMatches,
} from "../components/localMedia/LocalMediaStates";
import { LocalScanLine } from "../components/localMedia/LocalScanLine";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { getPlural, getString } from "../lib/i18n/index";
import { isFiltering } from "../lib/localMedia/filters";
import { playLocalFiles } from "../lib/localMedia/playback";
import { useLocalMediaView } from "../lib/localMedia/useLocalMediaView";
import { SETTINGS } from "../lib/settings/schema";
import { useBoolPref } from "../lib/usePreference";
import { useLocalMediaStore } from "../store/useLocalMediaStore";
import type { LocalMediaKind } from "../lib/api/localMedia";

export default function LocalMedia() {
  const navigate = useNavigate();
  const loaded = useLocalMediaStore((s) => s.loaded);
  const loadError = useLocalMediaStore((s) => s.loadError);
  const folders = useLocalMediaStore((s) => s.folders);
  const plays = useLocalMediaStore((s) => s.plays);
  const scan = useLocalMediaStore((s) => s.scan);
  const kind = useLocalMediaStore((s) => s.kind);
  const filters = useLocalMediaStore((s) => s.filters);
  const load = useLocalMediaStore((s) => s.load);
  const rescan = useLocalMediaStore((s) => s.rescan);
  const addFolder = useLocalMediaStore((s) => s.addFolder);
  const setKind = useLocalMediaStore((s) => s.setKind);
  const setOpenFolder = useLocalMediaStore((s) => s.setOpenFolder);
  const updateFilters = useLocalMediaStore((s) => s.updateFilters);
  const resetFilters = useLocalMediaStore((s) => s.resetFilters);
  const [videosAsGrid] = useBoolPref(SETTINGS.LOCAL_MEDIA_VIDEOS_AS_GRID);
  const view = useLocalMediaView();

  useEffect(() => {
    void load();
  }, [load]);

  const isVideos = kind === "video";
  const hasFolders = folders.some((folder) => folder.role === "include");
  const unavailable = folders.filter((folder) => folder.role === "include" && !folder.available);
  const chooseFolder = () => void addFolder(getString("local_media_pick_folder_title"), false);
  const canClearFilters = isFiltering(filters);

  const renderBody = () => {
    if (!loaded) return <LocalLoading />;
    if (loadError) return <LocalLoadFailed onRetry={() => void load()} />;
    if (!hasFolders) return <LocalNoFolders onChoose={chooseFolder} />;
    if (view.totalCount === 0) return <LocalEmpty isVideos={isVideos} scanning={scan.running} />;
    if (view.listsFolders) {
      return <LocalFolderList folders={view.folders} isVideos={isVideos} onOpen={setOpenFolder} />;
    }
    if (view.items.length === 0) {
      return <LocalNoMatches onClear={canClearFilters ? resetFilters : undefined} />;
    }
    return <LocalFileList files={view.items} plays={plays} nowMs={view.nowMs} asGrid={isVideos && videosAsGrid} />;
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full flex-col gap-5 pb-20">
        <header className="flex flex-col gap-4 border-b border-chrome-neutral-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100 lg:text-4xl">
              {getString("library_local_media_label")}
            </h1>
            <p className="mt-2 text-sm text-chrome-neutral-400">{getString("library_local_media_subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<LocalMediaKind>
              label={getString("local_media_kind_label")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "video", label: getString("local_media_tab_videos") },
                { value: "audio", label: getString("local_media_tab_music") },
              ]}
            />
            <Button type="button" variant="tonal" onClick={() => void rescan()} disabled={scan.running || !hasFolders}>
              <RefreshCw size={16} />
              {getString("local_media_rescan")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/settings", { state: { settingsCategory: "downloads" } })} aria-label={getString("settings")}>
              <SettingsIcon size={16} />
            </Button>
          </div>
        </header>

        <LocalScanLine />
        {unavailable.map((folder) => (
          <p key={folder.path} className="text-sm text-chrome-neutral-400" title={folder.path}>
            {getString("local_media_folder_unavailable")} ({folder.path})
          </p>
        ))}

        {hasFolders && (
          <>
            <SearchInput
              value={filters.query}
              onChange={(event) => updateFilters({ query: event.target.value })}
              placeholder={getString("local_search_hint")}
              containerClassName="w-full sm:w-96"
            />
            <LocalMediaFilterBar />
            {view.hiddenCount > 0 && (
              <p className="text-xs text-chrome-neutral-500">
                {getPlural("local_hidden_count", view.hiddenCount)}
                {" · "}
                <button
                  type="button"
                  onClick={() => navigate("/settings", { state: { settingsCategory: "downloads" } })}
                  className="rounded-sm font-medium text-chrome-neutral-300 transition-colors duration-200 ease-out hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {getString("local_manage")}
                </button>
              </p>
            )}
          </>
        )}

        {view.openFolder && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenFolder(null)}>
              <ChevronLeft size={16} />
              {getString("local_back_to_folders")}
            </Button>
            <h2 className="truncate text-base font-medium text-chrome-neutral-100" title={view.openFolder.path}>
              {view.openFolder.name}
            </h2>
          </div>
        )}

        {!view.listsFolders && !filters.query.trim() && (
          <LocalContinueShelf files={view.continueWatching} plays={plays} nowMs={view.nowMs} />
        )}

        {!view.listsFolders && view.items.length > 0 && (
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => playLocalFiles(view.items, 0, navigate)}>
              <Play size={16} />
              {getString("music_play_all")}
            </Button>
            <Button type="button" variant="tonal" onClick={() => playLocalFiles(view.items, 0, navigate, { shuffle: true })}>
              <Shuffle size={16} />
              {getString("shuffle")}
            </Button>
            <span className="text-sm tabular-nums text-chrome-neutral-400">
              {getPlural(isVideos ? "local_videos_count" : "local_songs_count", view.items.length)}
            </span>
          </div>
        )}

        {renderBody()}
      </div>
    </div>
  );
}
