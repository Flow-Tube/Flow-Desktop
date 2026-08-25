import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { TextInput } from '../../ui/TextInput';
import { useBoolPref, usePreference, useNumberPref } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import {
  getOrderedProviders,
  parseProviderEnabledStates,
  serializeProviderEnabledStates,
} from '../../../lib/lyrics/registry';

export function PlayerTab() {
  const [autoplay, setAutoplay] = useBoolPref(SETTINGS.AUTOPLAY_ENABLED, true);
  const [loop, setLoop] = useBoolPref(SETTINGS.VIDEO_LOOP_ENABLED, false);
  const [skipSilence, setSkipSilence] = useBoolPref(SETTINGS.SKIP_SILENCE_ENABLED, false);
  const [stableVolume, setStableVolume] = useBoolPref(SETTINGS.STABLE_VOLUME_ENABLED, false);
  const [volumeBoost, setVolumeBoost] = useBoolPref(SETTINGS.ALLOW_VOLUME_BOOST, false);

  const [rememberSpeed, setRememberSpeed] = useBoolPref(SETTINGS.REMEMBER_PLAYBACK_SPEED, false);
  const [playbackSpeed, setPlaybackSpeed] = usePreference(SETTINGS.PLAYBACK_SPEED, '1.0');
  const [customSpeeds, setCustomSpeeds] = useBoolPref(SETTINGS.CUSTOM_SPEEDS_ENABLED, false);
  const [customPresets, setCustomPresets] = usePreference(SETTINGS.CUSTOM_SPEED_PRESETS, '');
  const [longPressSpeed, setLongPressSpeed] = usePreference(SETTINGS.LONG_PRESS_PLAYBACK_SPEED, '2.0');
  const [speedSlider, setSpeedSlider] = useBoolPref(SETTINGS.SPEED_SLIDER_ENABLED, false);

  const [doubleTapSeek, setDoubleTapSeek] = useNumberPref(SETTINGS.DOUBLE_TAP_SEEK_SECONDS, 10);
  const [musicBackground, setMusicBackground] = usePreference(SETTINGS.MUSIC_PLAYER_BACKGROUND);

  const [subtitles, setSubtitles] = useBoolPref(SETTINGS.SUBTITLES_ENABLED, false);
  const [subtitleLang, setSubtitleLang] = usePreference(SETTINGS.PREFERRED_SUBTITLE_LANGUAGE, 'en');
  const [subtitleSize, setSubtitleSize] = usePreference(SETTINGS.SUBTITLE_FONT_SIZE, '14');
  const [subtitleBold, setSubtitleBold] = useBoolPref(SETTINGS.SUBTITLE_BOLD, true);
  const [lyricsProviderOrder] = usePreference(SETTINGS.LYRICS_PROVIDER_ORDER, '');
  const [lyricsEnabledRaw, setLyricsEnabledRaw] = usePreference(SETTINGS.LYRICS_PROVIDER_ENABLED_STATES, '{}');
  const lyricsProviders = getOrderedProviders(lyricsProviderOrder);
  const lyricsEnabledStates = parseProviderEnabledStates(lyricsEnabledRaw);
  const lyricsEnabledCount = lyricsProviders.filter((provider) => lyricsEnabledStates[provider.name] !== false).length;
  const setLyricsProviderEnabled = (providerName: string, enabled: boolean) => {
    setLyricsEnabledRaw(serializeProviderEnabledStates({ ...lyricsEnabledStates, [providerName]: enabled }));
  };

  const [miniSkip, setMiniSkip] = useBoolPref(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS, true);
  const [miniNextPrev, setMiniNextPrev] = useBoolPref(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS, true);

  const [fullscreenTitle, setFullscreenTitle] = useBoolPref(SETTINGS.SHOW_FULLSCREEN_TITLE, false);
  const [adaptiveSize, setAdaptiveSize] = useBoolPref(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED, true);

  const [autoPip, setAutoPip] = useBoolPref(SETTINGS.AUTO_PIP_ENABLED, false);
  const [pipButton, setPipButton] = useBoolPref(SETTINGS.MANUAL_PIP_BUTTON_ENABLED, true);
  const [pipSeparateWindow, setPipSeparateWindow] = useBoolPref(SETTINGS.PIP_SEPARATE_WINDOW, true);
  const [pipAlwaysOnTop, setPipAlwaysOnTop] = useBoolPref(SETTINGS.PIP_ALWAYS_ON_TOP, true);
  const [pipOnMinimize, setPipOnMinimize] = useBoolPref(SETTINGS.PIP_ON_MINIMIZE, true);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_playback')}>
        <SettingItem title={getString('settings_autoplay')} description={getString('settings_autoplay_desc')}>
          <ToggleSwitch checked={autoplay} onChange={setAutoplay} />
        </SettingItem>
        <SettingItem title={getString('settings_loop_video')} description={getString('settings_loop_video_desc')}>
          <ToggleSwitch checked={loop} onChange={setLoop} />
        </SettingItem>
        <SettingItem title={getString('settings_skip_silence')} description={getString('settings_skip_silence_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.SKIP_SILENCE_ENABLED)}>
          <ToggleSwitch checked={skipSilence} onChange={setSkipSilence} disabled={isSettingDisabledUntilWired(SETTINGS.SKIP_SILENCE_ENABLED)} />
        </SettingItem>
        <SettingItem title={getString('settings_stable_volume')} description={getString('settings_stable_volume_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.STABLE_VOLUME_ENABLED)}>
          <ToggleSwitch checked={stableVolume} onChange={setStableVolume} disabled={isSettingDisabledUntilWired(SETTINGS.STABLE_VOLUME_ENABLED)} />
        </SettingItem>
        <SettingItem title={getString('settings_volume_boost')} description={getString('settings_volume_boost_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.ALLOW_VOLUME_BOOST)}>
          <ToggleSwitch checked={volumeBoost} onChange={setVolumeBoost} disabled={isSettingDisabledUntilWired(SETTINGS.ALLOW_VOLUME_BOOST)} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_speed')}>
        <SettingItem title={getString('settings_remember_speed')} description={getString('settings_remember_speed_desc')}>
          <ToggleSwitch checked={rememberSpeed} onChange={setRememberSpeed} />
        </SettingItem>
        <SettingItem title={getString('settings_default_speed')}>
          <Select value={playbackSpeed} onChange={setPlaybackSpeed} options={[
            { value: '0.25', label: '0.25x' }, { value: '0.5', label: '0.5x' },
            { value: '0.75', label: '0.75x' }, { value: '1.0', label: '1.0x' },
            { value: '1.25', label: '1.25x' }, { value: '1.5', label: '1.5x' },
            { value: '1.75', label: '1.75x' }, { value: '2.0', label: '2.0x' },
            { value: '2.5', label: '2.5x' }, { value: '3.0', label: '3.0x' }, { value: '4.0', label: '4.0x' },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_custom_speed_presets')} description={getString('settings_custom_speed_presets_desc')}>
          <ToggleSwitch checked={customSpeeds} onChange={setCustomSpeeds} />
        </SettingItem>
        {customSpeeds && (
          <SettingItem title={getString('settings_speed_values')} description={getString('settings_speed_values_desc')}>
          <TextInput value={customPresets} onChange={setCustomPresets} placeholder="0.5,1.0,1.5,2.0" className="w-48" />
          </SettingItem>
        )}
        <SettingItem title={getString('settings_long_press_speed')} description={getString('settings_long_press_speed_desc')}>
          <Select value={longPressSpeed} onChange={setLongPressSpeed} options={[
            { value: '1.5', label: '1.5x' }, { value: '2.0', label: '2.0x' },
            { value: '2.5', label: '2.5x' }, { value: '3.0', label: '3.0x' }, { value: '4.0', label: '4.0x' },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_speed_slider')} description={getString('settings_speed_slider_desc')}>
          <ToggleSwitch checked={speedSlider} onChange={setSpeedSlider} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_seek')}>
        <SettingItem title={getString('settings_seek_interval')} description={getString('settings_seek_interval_desc')}>
          <Select value={String(doubleTapSeek)} onChange={(v) => setDoubleTapSeek(Number(v))} options={[
            { value: '5', label: '5s' }, { value: '10', label: '10s' }, { value: '15', label: '15s' },
            { value: '20', label: '20s' }, { value: '30', label: '30s' },
          ]} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_subtitles')}>
        <SettingItem title={getString('settings_closed_captions')} description={getString('settings_closed_captions_desc')}>
          <ToggleSwitch checked={subtitles} onChange={setSubtitles} />
        </SettingItem>
        <SettingItem title={getString('settings_preferred_language')}>
          <Select value={subtitleLang} onChange={setSubtitleLang} options={[
            { value: 'en', label: getString('settings_language_english') }, { value: 'es', label: getString('settings_language_spanish') },
            { value: 'fr', label: getString('settings_language_french') }, { value: 'de', label: getString('settings_language_german') },
            { value: 'pt', label: getString('settings_language_portuguese') }, { value: 'ja', label: getString('settings_language_japanese') },
            { value: 'ko', label: getString('settings_language_korean') }, { value: 'zh', label: getString('settings_language_chinese') },
            { value: 'ar', label: getString('settings_language_arabic') }, { value: 'hi', label: getString('settings_language_hindi') }, { value: 'ru', label: getString('settings_language_russian') },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_font_size')}>
          <Select value={subtitleSize} onChange={setSubtitleSize} options={[
            { value: '10', label: '10' }, { value: '12', label: '12' }, { value: '14', label: '14' },
            { value: '16', label: '16' }, { value: '18', label: '18' }, { value: '20', label: '20' }, { value: '24', label: '24' },
          ]} />
        </SettingItem>
        <SettingItem title={getString('settings_bold_subtitles')}>
          <ToggleSwitch checked={subtitleBold} onChange={setSubtitleBold} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_lyrics')}>
        <SettingItem
          title={getString('settings_lyrics_providers')}
          description={`${lyricsEnabledCount} / ${lyricsProviders.length} ${getString('settings_lyrics_providers_enabled')}`}
        >
          <span className="text-xs font-medium text-chrome-neutral-400">
            {getString('settings_lyrics_ordered')}
          </span>
        </SettingItem>
        {lyricsProviders.map((provider, index) => {
          const enabled = lyricsEnabledStates[provider.name] !== false;
          return (
            <SettingItem
              key={provider.name}
              title={`${index + 1}. ${provider.name}`}
              description={enabled ? getString('settings_lyrics_provider_enabled') : getString('settings_lyrics_provider_disabled')}
            >
              <ToggleSwitch checked={enabled} onChange={(next) => setLyricsProviderEnabled(provider.name, next)} />
            </SettingItem>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_mini_player')}>
        <SettingItem title={getString('settings_skip_controls')} description={getString('settings_skip_controls_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS)}>
          <ToggleSwitch checked={miniSkip} onChange={setMiniSkip} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS)} />
        </SettingItem>
        <SettingItem title={getString('settings_next_previous')} description={getString('settings_next_previous_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS)}>
          <ToggleSwitch checked={miniNextPrev} onChange={setMiniNextPrev} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS)} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_pip')}>
        <SettingItem title={getString('settings_auto_pip')} description={getString('settings_auto_pip_desc')}>
          <ToggleSwitch checked={autoPip} onChange={setAutoPip} />
        </SettingItem>
        <SettingItem title={getString('settings_pip_toggle')} description={getString('settings_pip_toggle_desc')}>
          <ToggleSwitch checked={pipButton} onChange={setPipButton} />
        </SettingItem>
        <SettingItem title={getString('settings_pip_separate_window')} description={getString('settings_pip_separate_window_desc')}>
          <ToggleSwitch checked={pipSeparateWindow} onChange={setPipSeparateWindow} />
        </SettingItem>
        <SettingItem title={getString('settings_pip_always_on_top')} description={getString('settings_pip_always_on_top_desc')} disabled={!pipSeparateWindow}>
          <ToggleSwitch checked={pipAlwaysOnTop} onChange={setPipAlwaysOnTop} disabled={!pipSeparateWindow} />
        </SettingItem>
        <SettingItem title={getString('settings_pip_on_minimize')} description={getString('settings_pip_on_minimize_desc')} disabled={!pipSeparateWindow}>
          <ToggleSwitch checked={pipOnMinimize} onChange={setPipOnMinimize} disabled={!pipSeparateWindow} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_player_appearance')}>
        <SettingItem title={getString('settings_fullscreen_title')} description={getString('settings_fullscreen_title_desc')}>
          <ToggleSwitch checked={fullscreenTitle} onChange={setFullscreenTitle} />
        </SettingItem>
        <SettingItem title={getString('settings_adaptive_player')} description={getString('settings_adaptive_player_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED)}>
          <ToggleSwitch checked={adaptiveSize} onChange={setAdaptiveSize} disabled={isSettingDisabledUntilWired(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED)} />
        </SettingItem>
        <SettingItem title={getString('settings_music_player_background')} description={getString('settings_music_player_background_desc')}>
          <Select value={musicBackground} onChange={setMusicBackground} options={[
            { value: 'blur_gradient', label: getString('settings_music_player_background_blur_gradient') },
            { value: 'blur', label: getString('settings_music_player_background_blur') },
            { value: 'gradient', label: getString('settings_music_player_background_gradient') },
            { value: 'default', label: getString('settings_music_player_background_default') },
          ]} />
        </SettingItem>
      </SettingsGroup>
    </div>
  );
}
