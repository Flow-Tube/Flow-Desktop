import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference, useNumberPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { GRID_COLUMN_OPTIONS, GRID_COLUMNS_DEFAULT } from '../../../lib/useGridColumns';
import { useHideWatched } from '../../../lib/useWatchedFilter';
import { BlockedKeywordsPanel } from '../BlockedKeywordsPanel';
import { LibrarySectionsGroup } from '../LibrarySectionsGroup';

export function ContentTab() {
  const [titleMaxLines, setTitleMaxLines] = useNumberPref(SETTINGS.VIDEO_TITLE_MAX_LINES, 1);
  const [gridColumns, setGridColumns] = useNumberPref(SETTINGS.GRID_COLUMNS, GRID_COLUMNS_DEFAULT);
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
  const [homeMaxVideoAge, setHomeMaxVideoAge] = usePreference(SETTINGS.HOME_MAX_VIDEO_AGE, '0');

  return (
    <div className="space-y-6 pb-8">
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

      <LibrarySectionsGroup />

      <SettingsGroup title={getString('settings_group_nav_tabs')}>
        <SettingItem title={getString('settings_tabs_enabled')} description={getString('settings_tabs_enabled_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.TABS_ENABLED)}><ToggleSwitch checked={tabsOn} onChange={setTabsOn} disabled={isSettingDisabledUntilWired(SETTINGS.TABS_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_shorts_tab')} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)}><ToggleSwitch checked={shortsNav} onChange={setShortsNav} disabled={!shortsContent || isSettingDisabledUntilWired(SETTINGS.SHORTS_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_music_tab')} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)}><ToggleSwitch checked={musicNav} onChange={setMusicNav} disabled={isSettingDisabledUntilWired(SETTINGS.MUSIC_NAVIGATION_ENABLED)} /></SettingItem>
        <SettingItem title={getString('settings_categories_tab')} description={getString('settings_categories_tab_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)}><ToggleSwitch checked={categoriesTab} onChange={setCategoriesTab} disabled={isSettingDisabledUntilWired(SETTINGS.CATEGORIES_NAV_TAB_ENABLED)} /></SettingItem>
      </SettingsGroup>

    </div>
  );
}
