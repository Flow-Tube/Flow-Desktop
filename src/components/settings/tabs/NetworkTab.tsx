import { useState } from 'react';
import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { TextInput } from '../../ui/TextInput';
import { useBoolPref, usePreference, useNumberPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';

export function NetworkTab() {
  const [bufferProfile, setBufferProfile] = usePreference(SETTINGS.BUFFER_PROFILE, 'STABLE');
  const [minBuffer, setMinBuffer] = useNumberPref(SETTINGS.MIN_BUFFER_MS, 30000);
  const [maxBuffer, setMaxBuffer] = useNumberPref(SETTINGS.MAX_BUFFER_MS, 50000);
  const [playbackBuffer, setPlaybackBuffer] = useNumberPref(SETTINGS.BUFFER_FOR_PLAYBACK_MS, 2500);
  const [rebufferBuffer, setRebufferBuffer] = useNumberPref(SETTINGS.BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS, 5000);
  const [cacheSize, setCacheSize] = useNumberPref(SETTINGS.MEDIA_CACHE_SIZE_MB, 500);
  const [remoteSignatures, setRemoteSignatures] = useBoolPref(SETTINGS.REMOTE_SIGNATURE_FALLBACK, false);
  const [proxyEnabled, setProxyEnabled] = useBoolPref(SETTINGS.PROXY_ENABLED, false);
  const [proxyType, setProxyType] = usePreference(SETTINGS.PROXY_TYPE, 'http');
  const [proxyHost, setProxyHost] = usePreference(SETTINGS.PROXY_HOST, '');
  const [proxyPort, setProxyPort] = usePreference(SETTINGS.PROXY_PORT, '8080');
  const [proxyUser, setProxyUser] = usePreference(SETTINGS.PROXY_USERNAME, '');
  const [proxyPass, setProxyPass] = usePreference(SETTINGS.PROXY_PASSWORD, '');
  const [localPort, setLocalPort] = useState(proxyPort);
  const [localHost, setLocalHost] = useState(proxyHost);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_buffer_profile')}>
        <SettingItem title={getString('settings_buffering_strategy')} description={getString('settings_buffering_strategy_desc')}>
          <Select value={bufferProfile} onChange={setBufferProfile} options={[
            { value: 'AGGRESSIVE', label: getString('settings_buffer_fast_start') }, { value: 'STABLE', label: getString('settings_buffer_balanced') },
            { value: 'DATASAVER', label: getString('settings_buffer_data_saver') }, { value: 'CUSTOM', label: getString('settings_option_custom') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      {bufferProfile === 'CUSTOM' && (
        <SettingsGroup title={getString('settings_group_custom_buffer')}>
          <SettingItem title={getString('settings_min_buffer')} description={getString('settings_min_buffer_desc')}>
            <Select value={String(minBuffer)} onChange={(v) => setMinBuffer(Number(v))} options={[
              { value: '5000', label: '5,000 ms' }, { value: '12000', label: '12,000 ms' },
              { value: '20000', label: '20,000 ms' }, { value: '30000', label: '30,000 ms' }, { value: '50000', label: '50,000 ms' },
            ]} />
          </SettingItem>
          <SettingItem title={getString('settings_max_buffer')} description={getString('settings_max_buffer_desc')}>
            <Select value={String(maxBuffer)} onChange={(v) => setMaxBuffer(Number(v))} options={[
              { value: '25000', label: '25,000 ms' }, { value: '30000', label: '30,000 ms' },
              { value: '50000', label: '50,000 ms' }, { value: '80000', label: '80,000 ms' }, { value: '120000', label: '120,000 ms' },
            ]} />
          </SettingItem>
          <SettingItem title={getString('settings_startup_prebuffer')} description={getString('settings_startup_prebuffer_desc')}>
            <Select value={String(playbackBuffer)} onChange={(v) => setPlaybackBuffer(Number(v))} options={[
              { value: '500', label: '500 ms' }, { value: '1500', label: '1,500 ms' },
              { value: '2500', label: '2,500 ms' }, { value: '5000', label: '5,000 ms' },
            ]} />
          </SettingItem>
          <SettingItem title={getString('settings_rebuffer_recovery')} description={getString('settings_rebuffer_recovery_desc')}>
            <Select value={String(rebufferBuffer)} onChange={(v) => setRebufferBuffer(Number(v))} options={[
              { value: '2500', label: '2,500 ms' }, { value: '5000', label: '5,000 ms' },
              { value: '8000', label: '8,000 ms' }, { value: '10000', label: '10,000 ms' },
            ]} />
          </SettingItem>
        </SettingsGroup>
      )}

      <SettingsGroup title={getString('settings_group_cache')}>
        <SettingItem title={getString('settings_media_cache_limit')} description={getString('settings_media_cache_limit_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.MEDIA_CACHE_SIZE_MB)}>
          <Select value={String(cacheSize)} onChange={(v) => setCacheSize(Number(v))} disabled={isSettingDisabledUntilWired(SETTINGS.MEDIA_CACHE_SIZE_MB)} options={[
            { value: '100', label: '100 MB' }, { value: '200', label: '200 MB' }, { value: '500', label: '500 MB' },
            { value: '1000', label: '1 GB' }, { value: '2000', label: '2 GB' }, { value: '0', label: getString('settings_option_unlimited') },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_playback_sources')}>
        <SettingItem title={getString('settings_remote_signature_fallback')} description={getString('settings_remote_signature_fallback_desc')}>
          <ToggleSwitch checked={remoteSignatures} onChange={setRemoteSignatures} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_proxy')}>
        <SettingItem title={getString('settings_enable_proxy')} description={getString('settings_enable_proxy_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_ENABLED)}>
          <ToggleSwitch checked={proxyEnabled} onChange={setProxyEnabled} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_ENABLED)} />
        </SettingItem>
        {proxyEnabled && (
          <>
            <SettingItem title={getString('settings_proxy_protocol')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_TYPE)}>
              <Select value={proxyType} onChange={setProxyType} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_TYPE)} options={[
                { value: 'http', label: 'HTTP' }, { value: 'socks5', label: 'SOCKS5' }, { value: 'socks4', label: 'SOCKS4' },
              ]} />
            </SettingItem>
            <SettingItem title={getString('settings_proxy_host')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_HOST)}>
              <TextInput value={localHost} onChange={setLocalHost} onBlur={() => setProxyHost(localHost)} placeholder="127.0.0.1" className="w-48" disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_HOST)} />
            </SettingItem>
            <SettingItem title={getString('settings_proxy_port')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_PORT)}>
              <TextInput value={localPort} onChange={setLocalPort} onBlur={() => setProxyPort(localPort)} placeholder="8080" className="w-24" disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_PORT)} />
            </SettingItem>
            <SettingItem title={getString('settings_proxy_username')} description={getString('settings_proxy_username_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_USERNAME)}>
              <TextInput value={proxyUser} onChange={setProxyUser} placeholder={getString('settings_proxy_username')} className="w-48" disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_USERNAME)} />
            </SettingItem>
            <SettingItem title={getString('settings_proxy_password')} disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_PASSWORD)}>
              <TextInput value={proxyPass} onChange={setProxyPass} placeholder={getString('settings_proxy_password')} type="password" className="w-48" disabled={isSettingDisabledUntilWired(SETTINGS.PROXY_PASSWORD)} />
            </SettingItem>
          </>
        )}
      </SettingsGroup>
    </div>
  );
}
