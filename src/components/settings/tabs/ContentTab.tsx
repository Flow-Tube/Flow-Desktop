import { appLanguageOptions } from '../../../lib/i18n/appLanguageOptions';
import { useAppLanguage } from '../../../lib/i18n/useAppLanguage';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference, useNumberPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import {
  DEEP_FLOW_DURATION_OPTIONS,
  DEEP_FLOW_NEVER_EXPIRES_HOURS,
  getDeepFlowDurationLabel,
  setDeepFlowEnabled,
} from '../../../lib/deepFlow';
import { useAppSettingsStore } from '../../../store/useAppSettingsStore';
import { REGION_OPTIONS } from '../../../lib/regionOptions';
import { CONTENT_LANGUAGE_OPTIONS } from '../../../lib/contentLanguages';
import { GRID_COLUMN_OPTIONS, GRID_COLUMNS_DEFAULT } from '../../../lib/useGridColumns';
import { useHideWatched } from '../../../lib/useWatchedFilter';
import { BlockedKeywordsPanel } from '../BlockedKeywordsPanel';
import { LibrarySectionsGroup } from '../LibrarySectionsGroup';
import { SearchHistoryGroup } from '../SearchHistoryGroup';
import { WellbeingSection } from '../WellbeingSection';

export function ContentTab() {
  const deepFlowActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_FLOW_ACTIVE] === 'true');
  const [titleMaxLines, setTitleMaxLines] = useNumberPref(SETTINGS.VIDEO_TITLE_MAX_LINES, 1);
  const [gridColumns, setGridColumns] = useNumberPref(SETTINGS.GRID_COLUMNS, GRID_COLUMNS_DEFAULT);
  const [homeViewMode, setHomeViewMode] = usePreference(SETTINGS.HOME_VIEW_MODE);
  const [homeFeed, setHomeFeed] = useBoolPref(SETTINGS.HOME_FEED_ENABLED, true);
  const [appLogo, setAppLogo] = useBoolPref(SETTINGS.SHOW_APP_LOGO_ICON, true);
  const [shortsShelf, setShortsShelf] = useBoolPref(SETTINGS.SHORTS_SHELF_ENABLED, true);
  const [homeShortsShelf, setHomeShortsShelf] = useBoolPref(SETTINGS.HOME_SHORTS_SHELF_ENABLED, true);
  const [continueWatching, setContinueWatching] = useBoolPref(SETTINGS.CONTINUE_WATCHING_ENABLED, true);
  const [homeSubscriptions, setHomeSubscriptions] = useBoolPref(SETTINGS.HOME_SUBSCRIPTIONS_ENABLED, true);
  const [refreshOnReselect, setRefreshOnReselect] = useBoolPref(SETTINGS.REFRESH_HOME_ON_RESELECT, true);
  const [comments, setComments] = useBoolPref(SETTINGS.COMMENTS_ENABLED, true);
  const [notes, setNotes] = useBoolPref(SETTINGS.NOTES_ENABLED, true);
  const [channelNotes, setChannelNotes] = useBoolPref(SETTINGS.CHANNEL_NOTES_ENABLED, true);
  const [videoNotes, setVideoNotes] = useBoolPref(SETTINGS.VIDEO_NOTES_ENABLED, true);
  const [relatedVideos, setRelatedVideos] = useBoolPref(SETTINGS.SHOW_RELATED_VIDEOS, true);
  const [liveChat, setLiveChat] = useBoolPref(SETTINGS.LIVE_CHAT_ENABLED, true);
  const hideWatchedHome = useHideWatched('home');
  const hideWatchedSubscriptions = useHideWatched('subscriptions');
  const [, setHideWatchedHome] = usePreference(SETTINGS.HIDE_WATCHED_HOME_FEED);
  const [, setHideWatchedSubscriptions] = usePreference(SETTINGS.HIDE_WATCHED_SUBSCRIPTIONS);
  const [hideWatchedShorts, setHideWatchedShorts] = useBoolPref(SETTINGS.HIDE_WATCHED_SHORTS, true);
  const [watchedThreshold, setWatchedThreshold] = usePreference(SETTINGS.WATCHED_THRESHOLD);
  const [shortsContent, setShortsContent] = useBoolPref(SETTINGS.SHORTS_CONTENT_ENABLED, true);
  const [channelShortsTab, setChannelShortsTab] = useBoolPref(SETTINGS.CHANNEL_SHORTS_TAB_WHEN_HIDDEN, false);
  const [subsCollaborations, setSubsCollaborations] = useBoolPref(SETTINGS.SUBSCRIPTION_COLLABORATIONS_ENABLED, true);
  const [subsCheckedCount, setSubsCheckedCount] = useBoolPref(SETTINGS.SUBS_SHOW_CHECKED_VIDEO_COUNT, true);
  const [hideSeen, setHideSeen] = useBoolPref(SETTINGS.HIDE_SEEN_VIDEOS, false);
  const [removeWatched, setRemoveWatched] = useBoolPref(SETTINGS.REMOVE_WATCHED_FROM_WATCH_LATER, false);
  const [blockedMode, setBlockedMode] = usePreference(SETTINGS.BLOCKED_CONTENT_MODE, 'blur');
  const [disableShorts, setDisableShorts] = useBoolPref(SETTINGS.DISABLE_SHORTS_PLAYER, false);
  const [shortsNav, setShortsNav] = useBoolPref(SETTINGS.SHORTS_NAVIGATION_ENABLED, true);
  const [tabsOn, setTabsOn] = useBoolPref(SETTINGS.TABS_ENABLED, false);
  const [shortsPlaybackMode, setShortsPlaybackMode] = usePreference(SETTINGS.SHORTS_PLAYBACK_MODE, 'loop');
  const [shortsAutoScrollSeconds, setShortsAutoScrollSeconds] = useNumberPref(SETTINGS.SHORTS_AUTO_SCROLL_SECONDS, 10);
  const [musicNav, setMusicNav] = useBoolPref(SETTINGS.MUSIC_NAVIGATION_ENABLED, true);
  const [categoriesTab, setCategoriesTab] = useBoolPref(SETTINGS.CATEGORIES_NAV_TAB_ENABLED, false);
  const [subsRefresh, setSubsRefresh] = useBoolPref(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP, false);
  const [subsShowVideos, setSubsShowVideos] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS, true);
  const [subsShowShorts, setSubsShowShorts] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_SHORTS, true);
  const [subsShowLive, setSubsShowLive] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_LIVE, true);
  const [homeMaxVideoAge, setHomeMaxVideoAge] = usePreference(SETTINGS.HOME_MAX_VIDEO_AGE, '0');
  const [subsHideUnplayable, setSubsHideUnplayable] = useBoolPref(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS, false);
  const [notificationsEnabled, setNotificationsEnabled] = useBoolPref(SETTINGS.NOTIFICATIONS_ENABLED, true);
  const [notifShorts, setNotifShorts] = useBoolPref(SETTINGS.NOTIF_SHORTS_ENABLED, true);
  const [notificationInterval, setNotificationInterval] = usePreference(SETTINGS.NOTIFICATION_CHECK_INTERVAL, '360');
  const [regionPicker, setRegionPicker] = useBoolPref(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE, true);
  const [trendingRegion, setTrendingRegion] = usePreference(SETTINGS.TRENDING_REGION, 'US');
  const [appLanguage, setAppLanguage] = useAppLanguage();
  const [contentLanguage, setContentLanguage] = usePreference(SETTINGS.CONTENT_LANGUAGE, '');
  const [originalTitles, setOriginalTitles] = useBoolPref(SETTINGS.ORIGINAL_TITLES, false);
  const [deepFlowExpireHours, setDeepFlowExpireHours] = usePreference(SETTINGS.DEEP_FLOW_EXPIRE_HOURS, '4');
  const [deepFlowSaveHistory, setDeepFlowSaveHistory] = useBoolPref(SETTINGS.DEEP_FLOW_SAVE_HISTORY, false);

  const deepFlowHours = Number(deepFlowExpireHours);
  const deepFlowDurationLabel = getDeepFlowDurationLabel(deepFlowHours);
  const deepFlowDescription = deepFlowActive
    ? deepFlowHours === DEEP_FLOW_NEVER_EXPIRES_HOURS
      ? getString('deep_flow_active_until_disabled')
      : getString('deep_flow_learning_paused')
    : getString('deep_flow_mode_subtitle');

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('deep_flow_mode_title')}>
        <SettingItem title={getString('deep_flow_mode_title')} description={deepFlowDescription} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_ACTIVE)}>
          <ToggleSwitch
            checked={deepFlowActive}
            onChange={(enabled) => {
              void setDeepFlowEnabled(enabled);
            }}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_ACTIVE)}
          />
        </SettingItem>
        <SettingItem
          title={getString('deep_flow_expire_duration_title')}
          description={getString('deep_flow_expire_duration_subtitle', deepFlowDurationLabel)}
          disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_EXPIRE_HOURS)}
        >
          <Select
            value={deepFlowExpireHours}
            onChange={setDeepFlowExpireHours}
            disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_EXPIRE_HOURS)}
            options={DEEP_FLOW_DURATION_OPTIONS.map((hours) => ({
              value: String(hours),
              label: getDeepFlowDurationLabel(hours),
            }))}
          />
        </SettingItem>
        <SettingItem title={getString('deep_flow_save_history_title')} description={getString('deep_flow_save_history_subtitle')} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_SAVE_HISTORY)}>
          <ToggleSwitch checked={deepFlowSaveHistory} onChange={setDeepFlowSaveHistory} disabled={isSettingDisabledUntilWired(SETTINGS.DEEP_FLOW_SAVE_HISTORY)} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_layout')}>
        <SettingItem
          title={getString('settings_grid_columns')}
          description={getString('settings_grid_columns_desc', gridColumns)}
          disabled={isSettingDisabledUntilWired(SETTINGS.GRID_COLUMNS)}
        >
          <Select
            value={String(gridColumns)}
            onChange={(value) => setGridColumns(Number(value))}
            disabled={isSettingDisabledUntilWired(SETTINGS.GRID_COLUMNS)}
            options={GRID_COLUMN_OPTIONS.map((count) => ({
              value: String(count),
              label: getString('settings_grid_columns_option', count),
            }))}
          />
        </SettingItem>
        <SettingItem title={getString('settings_home_view_mode')} description={getString('settings_home_view_mode_desc')}>
          <Select value={homeViewMode} onChange={setHomeViewMode} options={[
            { value: 'GRID', label: getString('ui_grid_view') },
            { value: 'LIST', label: getString('ui_list_view') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_video_title_lines')} description={getString('settings_video_title_lines_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.VIDEO_TITLE_MAX_LINES)}>
          <Select value={String(titleMaxLines)} onChange={(v) => setTitleMaxLines(Number(v))} disabled={isSettingDisabledUntilWired(SETTINGS.VIDEO_TITLE_MAX_LINES)} options={[
            { value: '0', label: getString('settings_option_unlimited') }, { value: '1', label: getString('settings_option_one_line') }, { value: '2', label: getString('settings_option_two_lines') }, { value: '3', label: getString('settings_option_three_lines') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_feed')}>
        <SettingItem title={getString('settings_home_feed')} description={getString('settings_home_feed_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_FEED_ENABLED)}><ToggleSwitch checked={homeFeed} onChange={setHomeFeed} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_FEED_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_app_logo')} description={getString('settings_app_logo_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_APP_LOGO_ICON)}><ToggleSwitch checked={appLogo} onChange={setAppLogo} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_APP_LOGO_ICON)} /></SettingItem>
        <SettingItem title={getString('settings_shorts_shelf')} description={getString('settings_shorts_shelf_desc')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_SHELF_ENABLED)}><ToggleSwitch checked={shortsShelf} onChange={setShortsShelf} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_SHELF_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_home_shorts_shelf')} description={getString('settings_home_shorts_shelf_desc')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.HOME_SHORTS_SHELF_ENABLED)}><ToggleSwitch checked={homeShortsShelf} onChange={setHomeShortsShelf} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.HOME_SHORTS_SHELF_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_continue_watching')} description={getString('settings_continue_watching_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.CONTINUE_WATCHING_ENABLED)}><ToggleSwitch checked={continueWatching} onChange={setContinueWatching} disabled={isSettingDisabledUntilWired(SETTINGS.CONTINUE_WATCHING_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_home_subscriptions')} description={getString('settings_home_subscriptions_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_SUBSCRIPTIONS_ENABLED)}><ToggleSwitch checked={homeSubscriptions} onChange={setHomeSubscriptions} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_SUBSCRIPTIONS_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_home_refresh_on_reselect')} description={getString('settings_home_refresh_on_reselect_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.REFRESH_HOME_ON_RESELECT)}><ToggleSwitch checked={refreshOnReselect} onChange={setRefreshOnReselect} disabled={isSettingDisabledUntilWired(SETTINGS.REFRESH_HOME_ON_RESELECT)} /></SettingItem>
        <SettingItem title={getString('settings_home_max_age')} description={getString('settings_home_max_age_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_MAX_VIDEO_AGE)}>
          <Select value={homeMaxVideoAge} onChange={setHomeMaxVideoAge} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_MAX_VIDEO_AGE)} options={[
            { value: '0', label: getString('settings_home_max_age_off') },
            { value: '24', label: getString('settings_home_max_age_1d') },
            { value: '72', label: getString('settings_home_max_age_3d') },
            { value: '168', label: getString('settings_home_max_age_1w') },
            { value: '720', label: getString('settings_home_max_age_1m') },
            { value: '4320', label: getString('settings_home_max_age_6m') },
            { value: '8760', label: getString('settings_home_max_age_1y') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_content')}>
        <SettingItem title={getString('settings_comments')} description={getString('settings_comments_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.COMMENTS_ENABLED)}><ToggleSwitch checked={comments} onChange={setComments} disabled={isSettingDisabledUntilWired(SETTINGS.COMMENTS_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_notes')} description={getString('settings_notes_desc')}><ToggleSwitch checked={notes} onChange={setNotes} /></SettingItem>
        <SettingItem title={getString('settings_channel_notes')} description={getString('settings_channel_notes_desc')} disabled={!notes}><ToggleSwitch checked={channelNotes} onChange={setChannelNotes} disabled={!notes} /></SettingItem>
        <SettingItem title={getString('settings_video_notes')} description={getString('settings_video_notes_desc')} disabled={!notes}><ToggleSwitch checked={videoNotes} onChange={setVideoNotes} disabled={!notes} /></SettingItem>
        <SettingItem title={getString('settings_related_videos')} description={getString('settings_related_videos_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_RELATED_VIDEOS)}><ToggleSwitch checked={relatedVideos} onChange={setRelatedVideos} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_RELATED_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_live_chat')} description={getString('settings_live_chat_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.LIVE_CHAT_ENABLED)}><ToggleSwitch checked={liveChat} onChange={setLiveChat} disabled={isSettingDisabledUntilWired(SETTINGS.LIVE_CHAT_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_hide_watched_home')} description={getString('settings_hide_watched_home_desc')}><ToggleSwitch checked={hideWatchedHome} onChange={(on) => setHideWatchedHome(String(on))} /></SettingItem>
        <SettingItem title={getString('settings_hide_watched_subscriptions')} description={getString('settings_hide_watched_subscriptions_desc')}><ToggleSwitch checked={hideWatchedSubscriptions} onChange={(on) => setHideWatchedSubscriptions(String(on))} /></SettingItem>
        <SettingItem title={getString('settings_hide_watched_shorts')} description={getString('settings_hide_watched_shorts_desc')} disabled={!shortsContent}><ToggleSwitch checked={hideWatchedShorts} onChange={setHideWatchedShorts} disabled={!shortsContent} /></SettingItem>
        <SettingItem title={getString('settings_watched_threshold')} description={getString('settings_watched_threshold_desc')}>
          <Select value={watchedThreshold} onChange={setWatchedThreshold} options={[
            { value: 'PERCENT_90', label: getString('settings_watched_threshold_90') },
            { value: 'PERCENT_95', label: getString('settings_watched_threshold_95') },
            { value: 'PERCENT_99', label: getString('settings_watched_threshold_99') },
            { value: 'ALMOST_FINISHED', label: getString('settings_watched_threshold_almost') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_hide_seen')} description={getString('settings_hide_seen_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_SEEN_VIDEOS)}><ToggleSwitch checked={hideSeen} onChange={setHideSeen} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_SEEN_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_remove_watched_watch_later')} description={getString('settings_remove_watched_watch_later_desc')}><ToggleSwitch checked={removeWatched} onChange={setRemoveWatched} /></SettingItem>
        <SettingItem title={getString('settings_blocked_mode')} description={getString('settings_blocked_mode_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.BLOCKED_CONTENT_MODE)}>
          <Select value={blockedMode} onChange={setBlockedMode} disabled={isSettingDisabledUntilWired(SETTINGS.BLOCKED_CONTENT_MODE)} options={[
            { value: 'blur', label: getString('settings_blocked_mode_blur') },
            { value: 'hide', label: getString('settings_blocked_mode_hide') },
          ]} />
        </SettingItem>
        <BlockedKeywordsPanel />
        <SettingItem title={getString('settings_show_shorts_content')} description={getString('settings_show_shorts_content_desc')}><ToggleSwitch checked={shortsContent} onChange={setShortsContent} /></SettingItem>
        <SettingItem title={getString('settings_channel_shorts_tab')} description={getString('settings_channel_shorts_tab_desc')} disabled={shortsContent}><ToggleSwitch checked={channelShortsTab} onChange={setChannelShortsTab} disabled={shortsContent} /></SettingItem>
        <SettingItem title={getString('settings_disable_shorts_player')} description={getString('settings_disable_shorts_player_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.DISABLE_SHORTS_PLAYER)}><ToggleSwitch checked={disableShorts} onChange={setDisableShorts} disabled={isSettingDisabledUntilWired(SETTINGS.DISABLE_SHORTS_PLAYER)} /></SettingItem>
        <SettingItem title={getString('settings_shorts_playback_mode')} description={getString('settings_shorts_playback_mode_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_PLAYBACK_MODE)}>
          <Select value={shortsPlaybackMode} onChange={setShortsPlaybackMode} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_PLAYBACK_MODE)} options={[
            { value: 'loop', label: getString('settings_shorts_playback_loop') },
            { value: 'auto_next', label: getString('settings_shorts_playback_auto_next') },
            { value: 'auto_interval', label: getString('settings_shorts_playback_auto_interval') },
          ]} />
        </SettingItem>
        {shortsPlaybackMode === 'auto_interval' && (
          <SettingItem title={getString('settings_shorts_auto_scroll_seconds')} description={getString('settings_shorts_auto_scroll_seconds_desc', shortsAutoScrollSeconds)} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_AUTO_SCROLL_SECONDS)}>
            <Select value={String(shortsAutoScrollSeconds)} onChange={(value) => setShortsAutoScrollSeconds(Number(value))} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_AUTO_SCROLL_SECONDS)} options={Array.from({ length: 16 }, (_, index) => {
              const seconds = index + 5;
              return { value: String(seconds), label: `${seconds}s` };
            })} />
          </SettingItem>
        )}
      </SettingsGroup>

      <SearchHistoryGroup />

      <LibrarySectionsGroup />

      <SettingsGroup title={getString('settings_group_nav_tabs')}>
        <SettingItem title={getString('settings_tabs_enabled')} description={getString('settings_tabs_enabled_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.TABS_ENABLED)}><ToggleSwitch checked={tabsOn} onChange={setTabsOn} disabled={isSettingDisabledUntilWired(SETTINGS.TABS_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_shorts_tab')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)}><ToggleSwitch checked={shortsNav} onChange={setShortsNav} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_music_tab')} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)}><ToggleSwitch checked={musicNav} onChange={setMusicNav} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_categories_tab')} description={getString('settings_categories_tab_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)}><ToggleSwitch checked={categoriesTab} onChange={setCategoriesTab} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)} /></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_subscriptions')}>
        <SettingItem title={getString('settings_refresh_startup')} description={getString('settings_refresh_startup_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)}><ToggleSwitch checked={subsRefresh} onChange={setSubsRefresh} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)} /></SettingItem>
        <SettingItem title={getString('settings_show_videos')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)}><ToggleSwitch checked={subsShowVideos} onChange={setSubsShowVideos} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_show_shorts')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)}><ToggleSwitch checked={subsShowShorts} onChange={setSubsShowShorts} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)} /></SettingItem>
        <SettingItem title={getString('settings_show_live')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)}><ToggleSwitch checked={subsShowLive} onChange={setSubsShowLive} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)} /></SettingItem>
        <SettingItem title={getString('settings_hide_unplayable')} description={getString('settings_hide_unplayable_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS)}><ToggleSwitch checked={subsHideUnplayable} onChange={setSubsHideUnplayable} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS)} /></SettingItem>
        <SettingItem title={getString('settings_subs_collaborations')} description={getString('settings_subs_collaborations_desc')}><ToggleSwitch checked={subsCollaborations} onChange={setSubsCollaborations} /></SettingItem>
        <SettingItem title={getString('settings_subs_checked_count')} description={getString('settings_subs_checked_count_desc')}><ToggleSwitch checked={subsCheckedCount} onChange={setSubsCheckedCount} /></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_notifications')}>
        <SettingItem title={getString('settings_notifications_enabled')} description={getString('settings_notifications_enabled_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)}>
          <ToggleSwitch checked={notificationsEnabled} onChange={setNotificationsEnabled} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)} />
        </SettingItem>
        <SettingItem title={getString('settings_notif_shorts')} description={getString('settings_notif_shorts_desc')} disabled={!notificationsEnabled || !shortsContent}><ToggleSwitch checked={notifShorts} onChange={setNotifShorts} disabled={!notificationsEnabled || !shortsContent} /></SettingItem>
        <SettingItem title={getString('settings_notification_interval')} description={getString('settings_notification_interval_desc')} disabled={!notificationsEnabled || isSettingDisabledUntilWired(SETTINGS.NOTIFICATION_CHECK_INTERVAL)}>
          <Select
            value={notificationInterval}
            onChange={setNotificationInterval}
            disabled={!notificationsEnabled || isSettingDisabledUntilWired(SETTINGS.NOTIFICATION_CHECK_INTERVAL)}
            options={[
              { value: '15', label: getString('settings_notification_interval_15m') },
              { value: '30', label: getString('settings_notification_interval_30m') },
              { value: '60', label: getString('settings_notification_interval_1h') },
              { value: '180', label: getString('settings_notification_interval_3h') },
              { value: '360', label: getString('settings_notification_interval_6h') },
              { value: '720', label: getString('settings_notification_interval_12h') },
              { value: '1440', label: getString('settings_notification_interval_24h') },
            ]}
          />
        </SettingItem>
      </SettingsGroup>

      <WellbeingSection />

      <SettingsGroup title={getString('settings_group_region')}>
        <SettingItem title={getString('settings_app_language')} description={getString('settings_app_language_desc')}>
          <Select value={appLanguage} onChange={setAppLanguage} options={appLanguageOptions()} />
        </SettingItem>
        <SettingItem title={getString('settings_region_picker')} description={getString('settings_region_picker_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)}><ToggleSwitch checked={regionPicker} onChange={setRegionPicker} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)} /></SettingItem>
        <SettingItem title={getString('settings_trending_region')} description={getString('settings_trending_region_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)}><Select value={trendingRegion} onChange={setTrendingRegion} options={REGION_OPTIONS} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)} /></SettingItem>
        <SettingItem title={getString('settings_content_language')} description={getString('settings_content_language_desc')}>
          <Select
            value={contentLanguage}
            onChange={setContentLanguage}
            options={[{ value: '', label: getString('settings_content_language_default') }, ...CONTENT_LANGUAGE_OPTIONS]}
          />
        </SettingItem>
        <SettingItem title={getString('settings_original_titles')} description={getString('settings_original_titles_desc')}><ToggleSwitch checked={originalTitles} onChange={setOriginalTitles} /></SettingItem>
      </SettingsGroup>
    </div>
  );
}
