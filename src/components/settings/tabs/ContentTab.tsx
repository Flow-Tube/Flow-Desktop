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
import { GRID_COLUMN_OPTIONS, GRID_COLUMNS_DEFAULT } from '../../../lib/useGridColumns';

export function ContentTab() {
  const deepFlowActive = useAppSettingsStore((state) => state.values[SETTINGS.DEEP_FLOW_ACTIVE] === 'true');
  const [titleMaxLines, setTitleMaxLines] = useNumberPref(SETTINGS.VIDEO_TITLE_MAX_LINES, 1);
  const [gridColumns, setGridColumns] = useNumberPref(SETTINGS.GRID_COLUMNS, GRID_COLUMNS_DEFAULT);
  const [downloadDialogStyle, setDownloadDialogStyle] = usePreference(SETTINGS.DOWNLOAD_DIALOG_STYLE, 'FULL');
  const [homeFeed, setHomeFeed] = useBoolPref(SETTINGS.HOME_FEED_ENABLED, true);
  const [appLogo, setAppLogo] = useBoolPref(SETTINGS.SHOW_APP_LOGO_ICON, true);
  const [shortsShelf, setShortsShelf] = useBoolPref(SETTINGS.SHORTS_SHELF_ENABLED, true);
  const [homeShortsShelf, setHomeShortsShelf] = useBoolPref(SETTINGS.HOME_SHORTS_SHELF_ENABLED, true);
  const [continueWatching, setContinueWatching] = useBoolPref(SETTINGS.CONTINUE_WATCHING_ENABLED, true);
  const [comments, setComments] = useBoolPref(SETTINGS.COMMENTS_ENABLED, true);
  const [relatedVideos, setRelatedVideos] = useBoolPref(SETTINGS.SHOW_RELATED_VIDEOS, true);
  const [hideWatched, setHideWatched] = useBoolPref(SETTINGS.HIDE_WATCHED_VIDEOS, false);
  const [disableShorts, setDisableShorts] = useBoolPref(SETTINGS.DISABLE_SHORTS_PLAYER, false);
  const [shortsNav, setShortsNav] = useBoolPref(SETTINGS.SHORTS_NAVIGATION_ENABLED, true);
  const [shortsPlaybackMode, setShortsPlaybackMode] = usePreference(SETTINGS.SHORTS_PLAYBACK_MODE, 'loop');
  const [shortsAutoScrollSeconds, setShortsAutoScrollSeconds] = useNumberPref(SETTINGS.SHORTS_AUTO_SCROLL_SECONDS, 10);
  const [musicNav, setMusicNav] = useBoolPref(SETTINGS.MUSIC_NAVIGATION_ENABLED, true);
  const [categoriesTab, setCategoriesTab] = useBoolPref(SETTINGS.CATEGORIES_NAV_TAB_ENABLED, false);
  const [subsRefresh, setSubsRefresh] = useBoolPref(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP, false);
  const [subsShowVideos, setSubsShowVideos] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS, true);
  const [subsShowShorts, setSubsShowShorts] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_SHORTS, true);
  const [subsShowLive, setSubsShowLive] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_LIVE, true);
  const [notificationsEnabled, setNotificationsEnabled] = useBoolPref(SETTINGS.NOTIFICATIONS_ENABLED, true);
  const [notificationInterval, setNotificationInterval] = usePreference(SETTINGS.NOTIFICATION_CHECK_INTERVAL, '360');
  const [regionPicker, setRegionPicker] = useBoolPref(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE, true);
  const [trendingRegion, setTrendingRegion] = usePreference(SETTINGS.TRENDING_REGION, 'US');
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
        <SettingItem title={getString('settings_video_title_lines')} description={getString('settings_video_title_lines_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.VIDEO_TITLE_MAX_LINES)}>
          <Select value={String(titleMaxLines)} onChange={(v) => setTitleMaxLines(Number(v))} disabled={isSettingDisabledUntilWired(SETTINGS.VIDEO_TITLE_MAX_LINES)} options={[
            { value: '0', label: getString('settings_option_unlimited') }, { value: '1', label: getString('settings_option_one_line') }, { value: '2', label: getString('settings_option_two_lines') }, { value: '3', label: getString('settings_option_three_lines') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_download_dialog')} description={getString('settings_download_dialog_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.DOWNLOAD_DIALOG_STYLE)}>
          <Select value={downloadDialogStyle} onChange={setDownloadDialogStyle} disabled={isSettingDisabledUntilWired(SETTINGS.DOWNLOAD_DIALOG_STYLE)} options={[{ value: 'FULL', label: getString('settings_option_full') }, { value: 'COMPACT', label: getString('settings_option_compact') }]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_feed')}>
        <SettingItem title={getString('settings_home_feed')} description={getString('settings_home_feed_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_FEED_ENABLED)}><ToggleSwitch checked={homeFeed} onChange={setHomeFeed} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_FEED_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_app_logo')} description={getString('settings_app_logo_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_APP_LOGO_ICON)}><ToggleSwitch checked={appLogo} onChange={setAppLogo} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_APP_LOGO_ICON)} /></SettingItem>
        <SettingItem title={getString('settings_shorts_shelf')} description={getString('settings_shorts_shelf_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_SHELF_ENABLED)}><ToggleSwitch checked={shortsShelf} onChange={setShortsShelf} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_SHELF_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_home_shorts_shelf')} description={getString('settings_home_shorts_shelf_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_SHORTS_SHELF_ENABLED)}><ToggleSwitch checked={homeShortsShelf} onChange={setHomeShortsShelf} disabled={isSettingDisabledUntilWired(SETTINGS.HOME_SHORTS_SHELF_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_continue_watching')} description={getString('settings_continue_watching_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.CONTINUE_WATCHING_ENABLED)}><ToggleSwitch checked={continueWatching} onChange={setContinueWatching} disabled={isSettingDisabledUntilWired(SETTINGS.CONTINUE_WATCHING_ENABLED)} /></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_content')}>
        <SettingItem title={getString('settings_comments')} description={getString('settings_comments_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.COMMENTS_ENABLED)}><ToggleSwitch checked={comments} onChange={setComments} disabled={isSettingDisabledUntilWired(SETTINGS.COMMENTS_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_related_videos')} description={getString('settings_related_videos_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_RELATED_VIDEOS)}><ToggleSwitch checked={relatedVideos} onChange={setRelatedVideos} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_RELATED_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_hide_watched')} description={getString('settings_hide_watched_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_WATCHED_VIDEOS)}><ToggleSwitch checked={hideWatched} onChange={setHideWatched} disabled={isSettingDisabledUntilWired(SETTINGS.HIDE_WATCHED_VIDEOS)} /></SettingItem>
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

      <SettingsGroup title={getString('settings_group_nav_tabs')}>
        <SettingItem title={getString('settings_shorts_tab')} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)}><ToggleSwitch checked={shortsNav} onChange={setShortsNav} disabled={isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_music_tab')} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)}><ToggleSwitch checked={musicNav} onChange={setMusicNav} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_categories_tab')} description={getString('settings_categories_tab_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)}><ToggleSwitch checked={categoriesTab} onChange={setCategoriesTab} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)} /></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_subscriptions')}>
        <SettingItem title={getString('settings_refresh_startup')} description={getString('settings_refresh_startup_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)}><ToggleSwitch checked={subsRefresh} onChange={setSubsRefresh} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP)} /></SettingItem>
        <SettingItem title={getString('settings_show_videos')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)}><ToggleSwitch checked={subsShowVideos} onChange={setSubsShowVideos} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS)} /></SettingItem>
        <SettingItem title={getString('settings_show_shorts')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)}><ToggleSwitch checked={subsShowShorts} onChange={setSubsShowShorts} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_SHORTS)} /></SettingItem>
        <SettingItem title={getString('settings_show_live')} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)}><ToggleSwitch checked={subsShowLive} onChange={setSubsShowLive} disabled={isSettingDisabledUntilWired(SETTINGS.SUBSCRIPTION_SHOW_LIVE)} /></SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_notifications')}>
        <SettingItem title={getString('settings_notifications_enabled')} description={getString('settings_notifications_enabled_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)}>
          <ToggleSwitch checked={notificationsEnabled} onChange={setNotificationsEnabled} disabled={isSettingDisabledUntilWired(SETTINGS.NOTIFICATIONS_ENABLED)} />
        </SettingItem>
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

      <SettingsGroup title={getString('settings_group_region')}>
        <SettingItem title={getString('settings_region_picker')} description={getString('settings_region_picker_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)}><ToggleSwitch checked={regionPicker} onChange={setRegionPicker} disabled={isSettingDisabledUntilWired(SETTINGS.SHOW_REGION_PICKER_IN_EXPLORE)} /></SettingItem>
        <SettingItem title={getString('settings_trending_region')} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)}><Select value={trendingRegion} onChange={setTrendingRegion} options={REGION_OPTIONS} disabled={isSettingDisabledUntilWired(SETTINGS.TRENDING_REGION)} /></SettingItem>
      </SettingsGroup>
    </div>
  );
}
