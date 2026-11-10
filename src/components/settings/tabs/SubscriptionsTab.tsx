import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { useBoolPref, usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';

export function SubscriptionsTab() {
  const [shortsContent] = useBoolPref(SETTINGS.SHORTS_CONTENT_ENABLED, true);
  const [subsRefresh, setSubsRefresh] = useBoolPref(SETTINGS.SUBSCRIPTION_REFRESH_ON_STARTUP, false);
  const [subsShowVideos, setSubsShowVideos] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_VIDEOS, true);
  const [subsShowShorts, setSubsShowShorts] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_SHORTS, true);
  const [subsShowLive, setSubsShowLive] = useBoolPref(SETTINGS.SUBSCRIPTION_SHOW_LIVE, true);
  const [subsHideUnplayable, setSubsHideUnplayable] = useBoolPref(SETTINGS.HIDE_UNPLAYABLE_SUBSCRIPTIONS, false);
  const [subsCollaborations, setSubsCollaborations] = useBoolPref(SETTINGS.SUBSCRIPTION_COLLABORATIONS_ENABLED, true);
  const [subsCheckedCount, setSubsCheckedCount] = useBoolPref(SETTINGS.SUBS_SHOW_CHECKED_VIDEO_COUNT, true);
  const [notificationsEnabled, setNotificationsEnabled] = useBoolPref(SETTINGS.NOTIFICATIONS_ENABLED, true);
  const [notifShorts, setNotifShorts] = useBoolPref(SETTINGS.NOTIF_SHORTS_ENABLED, true);
  const [notificationInterval, setNotificationInterval] = usePreference(SETTINGS.NOTIFICATION_CHECK_INTERVAL, '360');

  return (
    <div className="space-y-6 pb-8">
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
    </div>
  );
}
