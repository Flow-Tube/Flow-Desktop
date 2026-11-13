import React, { useCallback, useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, ListChecks, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, User } from "lucide-react";
import { parseSubscriptionExport } from "../lib/api/youtube";
import { bootstrapFromSubscriptions } from "../lib/api/recommendation";
import { SETTINGS } from "../lib/settings/schema";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { useChannelShortsStore } from "../store/useChannelShortsStore";
import { useNotificationStore } from "../store/useNotificationStore";
import { useUiStore } from "../store/useUiStore";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { getString } from "../lib/i18n/index";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { CategoryChips } from "../components/layout/CategoryChips";
import { ChannelSwiper } from "../components/subscriptions/ChannelSwiper";
import { ScanProgressBar } from "../components/subscriptions/ScanProgressBar";
import { FeedFailedNotice } from "../components/subscriptions/FeedFailedNotice";
import { VideoGrid } from "../components/video/VideoGrid";
import { ShortsShelf } from "../components/shelf/ShortsShelf";
import { ChannelAvatarImage, getAvatarUrl } from "../components/subscriptions/ChannelAvatarImage";
import { LastRefreshedLine } from "../components/subscriptions/LastRefreshedLine";
import { SubscriptionsManage } from "../components/subscriptions/SubscriptionsManage";
import { channelCountLabel } from "../lib/channelGroupLabels";
import { useSubscriptionChannelDetails, useSubscriptionFeed } from "../lib/useSubscriptionFeed";
import { usePreference } from "../lib/usePreference";
import { useShortsEnabled } from "../lib/useShortsContent";
import { isVideoOfChannel } from "../lib/subscriptionFeedMerge";
import { sortSubscriptions, type SubscriptionSortMode } from "../lib/subscriptionSort";
import { useUnplayableVideoIds } from "../lib/useUnplayableVideoIds";
import { useFinishedShortIds, useSubscriptionsHiddenFilter } from "../lib/useWatchedFilter";
import { splitSubscriptionFeed } from "../lib/subscriptionFeedSplit";
import type { SubscribedChannel, SubscriptionGroup } from "../store/useSubscriptionStore";
import type { VideoSummary } from "../types/video";
import { Checkbox } from "../components/ui/Checkbox";

interface SubscriptionsProps {
  onPlay: (video: VideoSummary) => void;
  onAddToQueue: (video: VideoSummary) => void;
}

export const Subscriptions: React.FC<SubscriptionsProps> = ({ onPlay, onAddToQueue }) => {
  const navigate = useNavigate();
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const subscriptionGroups = useSubscriptionStore((s) => s.subscriptionGroups);
  const subscriptionGroupsLoaded = useSubscriptionStore((s) => s.subscriptionGroupsLoaded);
  const loadSubscriptions = useSubscriptionStore((s) => s.loadSubscriptions);
  const loadSubscriptionGroups = useSubscriptionStore((s) => s.loadSubscriptionGroups);
  const loading = useSubscriptionStore((s) => s.loading);
  const unsubscribe = useSubscriptionStore((s) => s.unsubscribe);
  const subscribe = useSubscriptionStore((s) => s.subscribe);
  const mergeSubscriptions = useSubscriptionStore((s) => s.mergeSubscriptions);
  const createSubscriptionGroup = useSubscriptionStore((s) => s.createSubscriptionGroup);
  const updateSubscriptionGroup = useSubscriptionStore((s) => s.updateSubscriptionGroup);
  const deleteSubscriptionGroup = useSubscriptionStore((s) => s.deleteSubscriptionGroup);
  const moveSubscriptionGroup = useSubscriptionStore((s) => s.moveSubscriptionGroup);
  const channelNotifications = useNotificationStore((state) => state.channelNotifications);
  const channelPrefsLoaded = useNotificationStore((state) => state.channelPrefsLoaded);
  const loadChannelPreferences = useNotificationStore((state) => state.loadChannelPreferences);
  const setChannelNotification = useNotificationStore((state) => state.setChannelNotification);
  const {
    videos,
    rssChannels,
    loading: feedLoading,
    error: feedError,
    scanProgress,
    failedChannelIds,
    lastRefreshedAt,
    refresh: refreshFeed,
    refreshChannels,
  } = useSubscriptionFeed(subscriptions);
  const failedChannelNames = useMemo(
    () =>
      failedChannelIds.map(
        (channelId) => subscriptions.find((channel) => channel.id === channelId)?.name ?? channelId,
      ),
    [failedChannelIds, subscriptions],
  );
  const channelDetails = useSubscriptionChannelDetails(subscriptions);
  const showSubscriptionVideos = useAppSettingsStore((state) => state.values[SETTINGS.SUBSCRIPTION_SHOW_VIDEOS] !== "false");
  const shortsEnabled = useShortsEnabled();
  const shortsExcludedChannels = useChannelShortsStore((state) => state.excluded);
  const loadShortsExcluded = useChannelShortsStore((state) => state.load);
  const showSubscriptionShorts =
    useAppSettingsStore(
      (state) => state.values[SETTINGS.SUBSCRIPTION_SHOW_SHORTS] !== "false" && state.values[SETTINGS.SHORTS_SHELF_ENABLED] !== "false",
    ) && shortsEnabled;
  const finishedShorts = useFinishedShortIds();
  const showSubscriptionLive = useAppSettingsStore((state) => state.values[SETTINGS.SUBSCRIPTION_SHOW_LIVE] !== "false");
  const isHidden = useSubscriptionsHiddenFilter();
  const showCheckedCount = useAppSettingsStore((state) => state.values[SETTINGS.SUBS_SHOW_CHECKED_VIDEO_COUNT] !== "false");
  const hideUnplayable = useAppSettingsStore((state) => state.values[SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS] === "true");
  const unplayableIds = useUnplayableVideoIds(hideUnplayable);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [savedGroupName, setSavedGroupName] = usePreference(SETTINGS.SUBS_SELECTED_GROUP);
  const selectedGroupName = savedGroupName || null;
  const setSelectedGroupName = useCallback((name: string | null) => setSavedGroupName(name ?? ""), [setSavedGroupName]);
  const [viewMode, setViewMode] = useState<"feed" | "manage">("feed");
  
  const [importText, setImportText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SubscriptionGroup | null>(null);

  useEffect(() => {
    loadSubscriptions();
    loadSubscriptionGroups();
    void loadShortsExcluded();
  }, [loadShortsExcluded, loadSubscriptionGroups, loadSubscriptions]);

  useEffect(() => {
    if (!channelPrefsLoaded) void loadChannelPreferences();
  }, [channelPrefsLoaded, loadChannelPreferences]);

  useEffect(() => {
    const updates: Record<string, Partial<Omit<SubscribedChannel, "id">>> = {};
    subscriptions.forEach((channel) => {
      const details = channelDetails[channel.id];
      if (!details) return;

      const avatarUrl = getAvatarUrl(details.avatarUrl);
      const nextName = details.name || channel.name;
      const nextSubscriberCountText = details.subscriberCountText || channel.subscriberCountText;
      const patch: Partial<Omit<SubscribedChannel, "id">> = {};
      if (avatarUrl && avatarUrl !== channel.avatarUrl) patch.avatarUrl = avatarUrl;
      if (nextName && nextName !== channel.name) patch.name = nextName;
      if (nextSubscriberCountText && nextSubscriberCountText !== channel.subscriberCountText) {
        patch.subscriberCountText = nextSubscriberCountText;
      }
      if (Object.keys(patch).length > 0) updates[channel.id] = patch;
    });

    if (Object.keys(updates).length > 0) void mergeSubscriptions(updates);
  }, [channelDetails, subscriptions, mergeSubscriptions]);

  useEffect(() => {
    const updates: Record<string, Partial<Omit<SubscribedChannel, "id">>> = {};
    rssChannels.forEach((rssChannel) => {
      const existing = subscriptions.find((channel) => channel.id === rssChannel.id);
      if (!existing) return;

      const avatarUrl = getAvatarUrl(rssChannel.avatarUrl);
      const nextName = rssChannel.name || existing.name;
      const patch: Partial<Omit<SubscribedChannel, "id">> = {};
      if (avatarUrl && avatarUrl !== existing.avatarUrl) patch.avatarUrl = avatarUrl;
      if (nextName && nextName !== existing.name && existing.name === "Imported Channel") {
        patch.name = nextName;
      }
      if (Object.keys(patch).length > 0) updates[existing.id] = patch;
    });

    if (Object.keys(updates).length > 0) void mergeSubscriptions(updates);
  }, [rssChannels, subscriptions, mergeSubscriptions]);

  const handleImport = async () => {
    if (!importText.trim()) return;
    setIsImporting(true);
    try {
      const parsed = await parseSubscriptionExport(importText);
      if (parsed.length > 0) {
        for (const [id, name] of parsed) {
          await subscribe(id, name);
        }
        void bootstrapFromSubscriptions(parsed.map(([, name]) => name)).catch((err) =>
          console.warn("Failed to seed topics from subscriptions", err),
        );
        setImportText("");
        setShowImportModal(false);
      } else {
        useUiStore.getState().showToast({ variant: "error", message: getString("subscriptions_import_nothing") });
      }
    } catch (e) {
      console.error("Import failed", e);
    } finally {
      setIsImporting(false);
    }
  };

  const query = searchQuery.trim().toLowerCase();

  const enrichedChannels = useMemo<SubscribedChannel[]>(() => {
    return subscriptions.map((channel) => {
      const details = channelDetails[channel.id];
      return {
        ...channel,
        name: details?.name || channel.name,
        avatarUrl: getAvatarUrl(channel.avatarUrl) || getAvatarUrl(details?.avatarUrl),
        subscriberCountText: details?.subscriberCountText || channel.subscriberCountText,
      };
    });
  }, [channelDetails, subscriptions]);

  const selectedGroup = useMemo(() => {
    if (!selectedGroupName) return null;
    return subscriptionGroups.find((group) => group.name === selectedGroupName) || null;
  }, [selectedGroupName, subscriptionGroups]);

  useEffect(() => {
    // Before the groups load, every saved name looks unknown.
    if (subscriptionGroupsLoaded && selectedGroupName && !selectedGroup) {
      setSelectedGroupName(null);
    }
  }, [selectedGroup, selectedGroupName, setSelectedGroupName, subscriptionGroupsLoaded]);

  const visibleChannels = useMemo(() => {
    if (!query) return enrichedChannels;
    return enrichedChannels.filter((channel) => channel.name.toLowerCase().includes(query));
  }, [enrichedChannels, query]);

  const feedChannels = useMemo(() => {
    if (!selectedGroup) return visibleChannels;
    const groupChannelIds = new Set(selectedGroup.channelIds);
    return visibleChannels.filter((channel) => groupChannelIds.has(channel.id));
  }, [selectedGroup, visibleChannels]);

  const [sortMode, setSortMode] = usePreference(SETTINGS.SUBS_SORT_MODE);
  const sortedFeedChannels = useMemo(
    () => sortSubscriptions(feedChannels, sortMode as SubscriptionSortMode, videos),
    [feedChannels, sortMode, videos],
  );
  const sortedManageChannels = useMemo(
    () => sortSubscriptions(visibleChannels, sortMode as SubscriptionSortMode, videos),
    [visibleChannels, sortMode, videos],
  );

  const channelsWithNewVideos = useMemo(() => {
    return new Set(
      videos
        .map((video) => video.channelId)
        .filter((channelId): channelId is string => Boolean(channelId)),
    );
  }, [videos]);

  const filteredVideos = useMemo(() => {
    return videos.filter((video) => {
      if (isHidden(video) || unplayableIds.has(video.id)) return false;

      const matchesSearch = !query
        || video.title.toLowerCase().includes(query)
        || video.channelName.toLowerCase().includes(query);
      const matchesChannel = !selectedChannelId || isVideoOfChannel(video, selectedChannelId);
      const matchesGroup = !selectedGroup
        || selectedGroup.channelIds.some((channelId) => isVideoOfChannel(video, channelId));

      return matchesSearch && matchesChannel && matchesGroup;
    });
  }, [isHidden, query, selectedChannelId, selectedGroup, unplayableIds, videos]);


  const { shortsForShelf, regularVideos } = useMemo(
    () =>
      splitSubscriptionFeed(filteredVideos, {
        showShorts: showSubscriptionShorts,
        showLive: showSubscriptionLive,
        showVideos: showSubscriptionVideos,
        excludedShortChannels: shortsExcludedChannels,
        finishedShorts,
      }),
    [filteredVideos, finishedShorts, shortsExcludedChannels, showSubscriptionLive, showSubscriptionShorts, showSubscriptionVideos],
  );

  const handleSelectChannel = (channel: SubscribedChannel) => {
    setSelectedChannelId((current) => current === channel.id ? null : channel.id);
    setViewMode("feed");
  };

  const handleGroupChange = (groupLabel: string) => {
    setSelectedGroupName(groupLabel === getString("subscriptions_group_all") ? null : groupLabel);
    setSelectedChannelId(null);
  };

  return (
    <div className="flex-grow overflow-y-auto px-6 py-6 md:px-8">
      <div className="space-y-6 pb-20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
            {getString("top_bar_subscriptions_title")}
          </h1>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={getString("subscriptions_search_placeholder")}
              containerClassName="w-full sm:w-72"
            />
            <div className="flex gap-2">
              <Button
                variant="tonal"
                onClick={() => setShowImportModal(true)}
                className="shrink-0"
              >
                <Upload size={16} />
                {getString("subscriptions_import_button")}
              </Button>
              {viewMode === "feed" && (
                <Button
                  variant="tonal"
                  disabled={scanProgress != null || feedLoading}
                  onClick={() => {
                    if (selectedGroup) void refreshChannels(selectedGroup.channelIds);
                    else refreshFeed();
                  }}
                  className="shrink-0"
                >
                  <RefreshCw size={16} className={scanProgress ? "animate-spin" : undefined} />
                  {getString("refresh")}
                </Button>
              )}
              <Button
                variant="tonal"
                onClick={() => setViewMode((mode) => mode === "feed" ? "manage" : "feed")}
                className="shrink-0"
              >
                <ListChecks size={16} />
                {viewMode === "feed"
                  ? getString("subscriptions_manage_button")
                  : getString("subscriptions_latest_button")}
              </Button>
            </div>
          </div>
        </div>

        {loading && subscriptions.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-[var(--color-primary)]" size={28} />
          </div>
        ) : (
          <>
            {viewMode === "feed" ? (
              <ChannelSwiper
                channels={sortedFeedChannels}
                selectedChannelId={selectedChannelId}
                channelsWithNewVideos={channelsWithNewVideos}
                onSelectChannel={handleSelectChannel}
              />
            ) : null}

            {viewMode === "feed" ? (
              <>
                <div className="flex items-center gap-3 border-y border-chrome-neutral-800">
                  <CategoryChips
                    categories={[
                      getString("subscriptions_group_all"),
                      ...subscriptionGroups.map((group) => group.name),
                    ]}
                    activeCategory={selectedGroupName || getString("subscriptions_group_all")}
                    onCategoryChange={handleGroupChange}
                    sticky={false}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="me-1 shrink-0"
                    onClick={() => setShowGroupsModal(true)}
                  >
                    <Pencil size={15} />
                    {getString("subscriptions_groups_manage")}
                  </Button>
                </div>

                {scanProgress ? <ScanProgressBar progress={scanProgress} /> : null}
                {!feedLoading && (
                  <FeedFailedNotice names={failedChannelNames} onRetry={refreshFeed} retrying={scanProgress != null} />
                )}

                <section className="pt-2">
                  <h2 className={`${lastRefreshedAt ? "mb-1" : "mb-4"} text-xl font-semibold text-chrome-neutral-100`}>
                    {getString("subscriptions_latest_header")}
                  </h2>
                  {lastRefreshedAt ? (
                    <LastRefreshedLine
                      refreshedAt={lastRefreshedAt}
                      checkedCount={videos.length}
                      showCount={showCheckedCount}
                    />
                  ) : null}

                  {feedError ? (
                    <div className="rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6 text-sm text-chrome-neutral-300">
                      {getString("subscriptions_feed_error")}
                    </div>
                  ) : feedLoading ? (
                    <VideoGrid loading={true} skeletonCount={10} onPlay={onPlay} />
                  ) : shortsForShelf.length > 0 || regularVideos.length > 0 ? (
                    <>
                      {shortsForShelf.length > 0 && (
                        <ShortsShelf
                          title={getString("shorts")}
                          shorts={shortsForShelf}
                          onPlay={onPlay}
                        />
                      )}
                      <VideoGrid
                        videos={regularVideos}
                        onPlay={onPlay}
                        onAddToQueue={onAddToQueue}
                      />
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
                      <User className="mb-3 text-chrome-neutral-600" size={36} />
                      <h3 className="text-base font-medium text-chrome-neutral-200">
                        {getString("subscriptions_empty_latest")}
                      </h3>
                      <p className="mt-1 max-w-md text-sm text-chrome-neutral-400">
                        {getString("subscriptions_empty_latest_body")}
                      </p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <SubscriptionsManage
                channels={sortedManageChannels}
                channelDetails={channelDetails}
                sortMode={sortMode as SubscriptionSortMode}
                onSortChange={setSortMode}
                channelNotifications={channelNotifications}
                onSetNotification={setChannelNotification}
                onOpenChannel={(channelId) => navigate(`/channel/${channelId}`)}
                onUnsubscribe={unsubscribe}
              />
            )}
          </>
        )}
      </div>

      {showGroupsModal && (
        <GroupsModal
          groups={subscriptionGroups}
          channels={enrichedChannels}
          editingGroup={editingGroup}
          onEdit={setEditingGroup}
          onClose={() => {
            setShowGroupsModal(false);
            setEditingGroup(null);
          }}
          onCreate={createSubscriptionGroup}
          onUpdate={async (oldName, name, channelIds) => {
            await updateSubscriptionGroup(oldName, name, channelIds);
            if (selectedGroupName === oldName && name.trim()) setSelectedGroupName(name.trim());
          }}
          onDelete={(name) => {
            deleteSubscriptionGroup(name);
            if (selectedGroupName === name) {
              setSelectedGroupName(null);
            }
          }}
          onMove={moveSubscriptionGroup}
        />
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/70 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-chrome-neutral-100">
                <Upload size={18} className="text-[var(--color-primary)]" />
                {getString("subscriptions_import_title")}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setShowImportModal(false)}>
                {getString("close")}
              </Button>
            </div>

            <p className="text-sm text-chrome-neutral-400">
              {getString("subscriptions_import_body")}
            </p>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={getString("subscriptions_import_placeholder")}
              rows={8}
              className="w-full resize-none rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-4 font-mono text-xs text-chrome-neutral-300 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-600 focus:border-chrome-neutral-700"
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setShowImportModal(false)}>
                {getString("cancel")}
              </Button>
              <Button onClick={handleImport} disabled={isImporting || !importText.trim()}>
                {isImporting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {getString("subscriptions_import_parsing")}
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    {getString("subscriptions_import_parse")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface GroupsModalProps {
  groups: SubscriptionGroup[];
  channels: SubscribedChannel[];
  editingGroup: SubscriptionGroup | null;
  onEdit: (group: SubscriptionGroup | null) => void;
  onClose: () => void;
  onCreate: (name: string, channelIds: string[]) => Promise<void>;
  onUpdate: (oldName: string, name: string, channelIds: string[]) => Promise<void>;
  onDelete: (name: string) => void;
  onMove: (name: string, direction: -1 | 1) => void;
}

function GroupsModal({
  groups,
  channels,
  editingGroup,
  onEdit,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onMove,
}: GroupsModalProps) {
  const [draftName, setDraftName] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [channelSearch, setChannelSearch] = useState("");

  const resetDraft = () => {
    setDraftName("");
    setSelectedChannelIds(new Set());
    setChannelSearch("");
    onEdit(null);
  };

  useEffect(() => {
    setDraftName(editingGroup?.name || "");
    setSelectedChannelIds(new Set(editingGroup?.channelIds || []));
    setChannelSearch("");
  }, [editingGroup]);

  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => channel.name.toLowerCase().includes(query));
  }, [channelSearch, channels]);

  const canSave = draftName.trim() && selectedChannelIds.size > 0;

  const toggleChannel = (channelId: string) => {
    setSelectedChannelIds((current) => {
      const next = new Set(current);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!canSave) return;
    const ids = Array.from(selectedChannelIds);
    if (editingGroup) {
      await onUpdate(editingGroup.name, draftName, ids);
    } else {
      await onCreate(draftName, ids);
    }
    resetDraft();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/70 p-4">
      <div className="grid h-[86vh] w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="flex min-h-0 flex-col border-b border-chrome-neutral-800 p-5 md:border-b-0 md:border-e">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-chrome-neutral-100">
              {getString("subscriptions_groups_manage")}
            </h3>
          </div>

          <Button variant="tonal" className="mb-4 justify-start" onClick={resetDraft}>
            <Plus size={16} />
            {getString("subscriptions_groups_new")}
          </Button>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-chrome-neutral-800 bg-surface-container-low">
            {groups.length > 0 ? (
              <div className="divide-y divide-chrome-neutral-800">
                {groups.map((group, index) => (
                  <div key={group.name} className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-start"
                      onClick={() => onEdit(group)}
                    >
                      <div dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{group.name}</div>
                      <div className="text-xs text-chrome-neutral-400">{channelCountLabel(group.channelIds.length)}</div>
                    </button>
                    <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(group.name, -1)}>
                      <ChevronUp size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" disabled={index === groups.length - 1} onClick={() => onMove(group.name, 1)}>
                      <ChevronDown size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(group)}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-chrome-red-400 hover:bg-chrome-red-950/30" onClick={() => onDelete(group.name)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-4 text-sm text-chrome-neutral-400">
                {getString("subscriptions_groups_empty")}
              </p>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-chrome-neutral-100">
              {editingGroup ? getString("subscriptions_groups_edit") : getString("subscriptions_groups_new")}
            </h3>
            <Button variant="ghost" size="md" onClick={onClose}>
              {getString("close")}
            </Button>
          </div>

          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={getString("subscriptions_groups_name")}
            className="mb-3 h-10 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700"
          />

          <SearchInput
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder={getString("subscriptions_groups_search")}
            containerClassName="mb-3"
          />

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-chrome-neutral-800 bg-surface-container-low">
            <div className="divide-y divide-chrome-neutral-800">
              {filteredChannels.map((channel) => {
                const avatarUrl = getAvatarUrl(channel.avatarUrl);
                const selected = selectedChannelIds.has(channel.id);
                const initial = channel.name.charAt(0).toUpperCase();

                return (
                  <Checkbox
                    key={channel.id}
                    checked={selected}
                    onChange={() => toggleChannel(channel.id)}
                    className="px-3 py-2 transition-colors duration-200 ease-out hover:bg-surface-container"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-xs font-semibold text-chrome-neutral-300">
                      {avatarUrl ? (
                        <ChannelAvatarImage src={avatarUrl} name={channel.name} />
                      ) : (
                        initial
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="line-clamp-1 text-sm font-medium text-chrome-neutral-100">{channel.name}</span>
                      <span className="line-clamp-1 text-xs text-chrome-neutral-400">
                        {channel.subscriberCountText || getString("subscriptions_subscribers_unavailable")}
                      </span>
                    </span>
                  </Checkbox>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button disabled={!canSave} onClick={handleSave}>
              {editingGroup ? getString("subscriptions_groups_save") : getString("subscriptions_groups_create")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Subscriptions;
