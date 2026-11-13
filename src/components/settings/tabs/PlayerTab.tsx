import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { Select } from '../../ui/Select';
import { TextInput } from '../../ui/TextInput';
import { Slider } from '../../ui/Slider';
import { AmbientModeIcon } from '../../ui/AmbientModeIcon';
import { useWheelValue } from '../../../lib/useWheelValue';
import { useBoolPref, usePreference, useNumberPref } from '../../../lib/usePreference';
import { getPlural, getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import { videoEqAvailable } from '../../../lib/audio/mediaEqEngine';
import { isSettingDisabledUntilWired } from '../../../lib/settings/values';
import { SUBTITLE_FONT_SCALES } from '../../../store/usePlayerStore';
import { LONG_PRESS_OFF } from '../../../lib/pointerGesture';
import { PLAYER_BUTTON_ROWS, type PlayerButtonRow } from '../../../lib/playerButtons';
import { audioLanguageOptions } from '../../../lib/audioLanguages';
import { NO_PREFERRED_LANGUAGE } from '../../../lib/settings/playerRuntime';
import { APP_LOCALE } from '../../../lib/i18n/index';
import { useCanPinWindows } from '../../../lib/graphicsReport';

const AUTOPLAY_DELAY_OPTIONS = [0, 3, 5, 10, 15, 20, 30];

const subtitleLanguageOptions = [
  { value: NO_PREFERRED_LANGUAGE, label: getString('settings_language_none') },
  ...audioLanguageOptions(APP_LOCALE),
];

function PlayerButtonSwitch({ row }: { row: PlayerButtonRow }) {
  const [shown, setShown] = useBoolPref(row.setting);
  return (
    <SettingItem title={getString(row.title)} description={getString(row.summary)}>
      <ToggleSwitch checked={shown} onChange={setShown} />
    </SettingItem>
  );
}

export function PlayerTab() {
  const [autoplay, setAutoplay] = useBoolPref(SETTINGS.AUTOPLAY_ENABLED, true);
  const [queueAutoplay, setQueueAutoplay] = useBoolPref(SETTINGS.QUEUE_AUTOPLAY_ENABLED, true);
  const [autoplayDelay, setAutoplayDelay] = useNumberPref(SETTINGS.AUTOPLAY_COUNTDOWN_SECONDS, 0);
  const [loop, setLoop] = useBoolPref(SETTINGS.VIDEO_LOOP_ENABLED, false);
  const [stableVolume, setStableVolume] = useBoolPref(SETTINGS.STABLE_VOLUME_ENABLED, false);
  const [videoLoudness, setVideoLoudness] = useBoolPref(SETTINGS.VIDEO_LOUDNESS_NORMALIZATION, false);
  const [volumeBoost, setVolumeBoost] = useBoolPref(SETTINGS.ALLOW_VOLUME_BOOST, false);

  const [rememberSpeed, setRememberSpeed] = useBoolPref(SETTINGS.REMEMBER_PLAYBACK_SPEED, false);
  const [speedPerChannel, setSpeedPerChannel] = useBoolPref(SETTINGS.SPEED_PER_CHANNEL);
  const [musicNormalSpeed, setMusicNormalSpeed] = useBoolPref(SETTINGS.MUSIC_AT_NORMAL_SPEED);
  const [playbackSpeed, setPlaybackSpeed] = usePreference(SETTINGS.PLAYBACK_SPEED, '1.0');
  const [customSpeeds, setCustomSpeeds] = useBoolPref(SETTINGS.CUSTOM_SPEEDS_ENABLED, false);
  const [customPresets, setCustomPresets] = usePreference(SETTINGS.CUSTOM_SPEED_PRESETS, '');
  const [longPressSpeed, setLongPressSpeed] = usePreference(SETTINGS.LONG_PRESS_PLAYBACK_SPEED, '2.0');
  const [speedSlider, setSpeedSlider] = useBoolPref(SETTINGS.SPEED_SLIDER_ENABLED, false);

  const [doubleTapSeek, setDoubleTapSeek] = useNumberPref(SETTINGS.DOUBLE_TAP_SEEK_SECONDS, 10);
  const [doubleClickSeek, setDoubleClickSeek] = useBoolPref(SETTINGS.DOUBLE_CLICK_SEEK_ENABLED, true);

  const [subtitles, setSubtitles] = useBoolPref(SETTINGS.SUBTITLES_ENABLED, false);
  const [subtitleLang, setSubtitleLang] = usePreference(SETTINGS.PREFERRED_SUBTITLE_LANGUAGE, 'en');
  const [subtitleScale, setSubtitleScale] = usePreference(SETTINGS.SUBTITLE_FONT_SCALE, '100');
  const [subtitleBold, setSubtitleBold] = useBoolPref(SETTINGS.SUBTITLE_BOLD, true);

  const [miniSkip, setMiniSkip] = useBoolPref(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS, true);
  const [miniNextPrev, setMiniNextPrev] = useBoolPref(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS, true);

  const [miniContinueWatching, setMiniContinueWatching] = useBoolPref(SETTINGS.MINI_PLAYER_CONTINUE_WATCHING_ENABLED);
  const [miniPlayerSize, setMiniPlayerSize] = usePreference(SETTINGS.MINI_PLAYER_SIZE);
  const [paidPromotion, setPaidPromotion] = useBoolPref(SETTINGS.PAID_PROMOTION_LABEL);
  const [idleProgress, setIdleProgress] = useBoolPref(SETTINGS.IDLE_PROGRESS_STRIP_ENABLED);
  const [frameStep, setFrameStep] = useBoolPref(SETTINGS.FRAME_STEP_BUTTONS_ENABLED);

  const [fullscreenTitle, setFullscreenTitle] = useBoolPref(SETTINGS.SHOW_FULLSCREEN_TITLE, false);
  const [ambientMode, setAmbientMode] = useBoolPref(SETTINGS.AMBIENT_MODE_ENABLED);
  const [ambientGlow, setAmbientGlow] = useBoolPref(SETTINGS.AMBIENT_GLOW_ENABLED);
  const [ambientIntensity, setAmbientIntensity] = useNumberPref(SETTINGS.AMBIENT_MODE_INTENSITY);
  const ambientIntensityWheelRef = useWheelValue<HTMLDivElement>({
    value: ambientIntensity,
    min: 10,
    max: 100,
    step: 5,
    disabled: !ambientMode,
    onChange: setAmbientIntensity,
  });
  const [adaptiveSize, setAdaptiveSize] = useBoolPref(SETTINGS.ADAPTIVE_PLAYER_SIZE_ENABLED, true);

  const [autoPip, setAutoPip] = useBoolPref(SETTINGS.AUTO_PIP_ENABLED, false);
  const [pipButton, setPipButton] = useBoolPref(SETTINGS.MANUAL_PIP_BUTTON_ENABLED, true);
  const [pipSeparateWindow, setPipSeparateWindow] = useBoolPref(SETTINGS.PIP_SEPARATE_WINDOW, true);
  const [pipAlwaysOnTop, setPipAlwaysOnTop] = useBoolPref(SETTINGS.PIP_ALWAYS_ON_TOP, true);
  const canPinWindows = useCanPinWindows();
  const [pipOnMinimize, setPipOnMinimize] = useBoolPref(SETTINGS.PIP_ON_MINIMIZE, true);

  return (
    <div className="space-y-6 pb-8">
      <SettingsGroup title={getString('settings_group_playback')}>
        <SettingItem title={getString('settings_autoplay')} description={getString('settings_autoplay_desc')}>
          <ToggleSwitch checked={autoplay} onChange={setAutoplay} />
        </SettingItem>
        <SettingItem title={getString('settings_queue_autoplay')} description={getString('settings_queue_autoplay_desc')}>
          <ToggleSwitch checked={queueAutoplay} onChange={setQueueAutoplay} />
        </SettingItem>
        <SettingItem title={getString('settings_autoplay_delay')} description={getString('settings_autoplay_delay_desc')}>
          <Select value={String(autoplayDelay)} onChange={(v) => setAutoplayDelay(Number(v))} options={AUTOPLAY_DELAY_OPTIONS.map((seconds) => (
            { value: String(seconds), label: seconds === 0 ? getString('settings_autoplay_delay_none') : getPlural('settings_autoplay_delay_seconds', seconds) }
          ))} />
        </SettingItem>
        <SettingItem title={getString('settings_loop_video')} description={getString('settings_loop_video_desc')}>
          <ToggleSwitch checked={loop} onChange={setLoop} />
        </SettingItem>
        <SettingItem title={getString('settings_stable_volume')} description={getString('settings_stable_volume_desc')}>
          <ToggleSwitch checked={stableVolume} onChange={setStableVolume} />
        </SettingItem>
        <SettingItem title={getString('settings_video_loudness')} description={getString('settings_video_loudness_desc')}>
          <ToggleSwitch checked={videoLoudness} onChange={setVideoLoudness} />
        </SettingItem>
        <SettingItem
          title={getString('settings_volume_boost')}
          description={getString(videoEqAvailable() ? 'settings_volume_boost_desc' : 'settings_volume_boost_unavailable')}
          disabled={!videoEqAvailable()}
        >
          <ToggleSwitch checked={volumeBoost} onChange={setVolumeBoost} disabled={!videoEqAvailable()} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_speed')}>
        <SettingItem title={getString('settings_remember_speed')} description={getString('settings_remember_speed_desc')}>
          <ToggleSwitch checked={rememberSpeed} onChange={setRememberSpeed} />
        </SettingItem>
        <SettingItem title={getString('settings_speed_per_channel')} description={getString('settings_speed_per_channel_desc')}>
          <ToggleSwitch checked={speedPerChannel} onChange={setSpeedPerChannel} />
        </SettingItem>
        <SettingItem title={getString('settings_music_normal_speed')} description={getString('settings_music_normal_speed_desc')}>
          <ToggleSwitch checked={musicNormalSpeed} onChange={setMusicNormalSpeed} />
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
            { value: LONG_PRESS_OFF, label: getString('settings_long_press_speed_off') },
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
        <SettingItem title={getString('settings_double_click_seek')} description={getString('settings_double_click_seek_desc')}>
          <ToggleSwitch checked={doubleClickSeek} onChange={setDoubleClickSeek} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_subtitles')}>
        <SettingItem title={getString('settings_closed_captions')} description={getString('settings_closed_captions_desc')}>
          <ToggleSwitch checked={subtitles} onChange={setSubtitles} />
        </SettingItem>
        <SettingItem title={getString('settings_preferred_language')}>
          <Select value={subtitleLang} onChange={setSubtitleLang} options={subtitleLanguageOptions} />
        </SettingItem>
        <SettingItem title={getString('settings_font_size')}>
          <Select value={subtitleScale} onChange={setSubtitleScale} options={SUBTITLE_FONT_SCALES.map((scale) => (
            { value: String(scale), label: `${scale}%` }
          ))} />
        </SettingItem>
        <SettingItem title={getString('settings_bold_subtitles')}>
          <ToggleSwitch checked={subtitleBold} onChange={setSubtitleBold} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_mini_player')}>
        <SettingItem title={getString('settings_skip_controls')} description={getString('settings_skip_controls_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS)}>
          <ToggleSwitch checked={miniSkip} onChange={setMiniSkip} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_SKIP_CONTROLS)} />
        </SettingItem>
        <SettingItem title={getString('settings_next_previous')} description={getString('settings_next_previous_desc')} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS)}>
          <ToggleSwitch checked={miniNextPrev} onChange={setMiniNextPrev} disabled={isSettingDisabledUntilWired(SETTINGS.MINI_PLAYER_SHOW_NEXT_PREV_CONTROLS)} />
        </SettingItem>
        <SettingItem title={getString('settings_mini_continue_watching')} description={getString('settings_mini_continue_watching_desc')}>
          <ToggleSwitch checked={miniContinueWatching} onChange={setMiniContinueWatching} />
        </SettingItem>
        <SettingItem title={getString('settings_mini_player_size')}>
          <Select value={miniPlayerSize} onChange={setMiniPlayerSize} options={[
            { value: 'small', label: getString('settings_mini_player_size_small') },
            { value: 'medium', label: getString('settings_mini_player_size_medium') },
            { value: 'large', label: getString('settings_mini_player_size_large') },
          ]} />
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
        {canPinWindows && (
          <SettingItem title={getString('settings_pip_always_on_top')} description={getString('settings_pip_always_on_top_desc')} disabled={!pipSeparateWindow}>
            <ToggleSwitch checked={pipAlwaysOnTop} onChange={setPipAlwaysOnTop} disabled={!pipSeparateWindow} />
          </SettingItem>
        )}
        <SettingItem title={getString('settings_pip_on_minimize')} description={getString('settings_pip_on_minimize_desc')} disabled={!pipSeparateWindow}>
          <ToggleSwitch checked={pipOnMinimize} onChange={setPipOnMinimize} disabled={!pipSeparateWindow} />
        </SettingItem>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_player_buttons')}>
        {PLAYER_BUTTON_ROWS.map((row) => <PlayerButtonSwitch key={row.id} row={row} />)}
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_player_appearance')}>
        <SettingItem title={getString('settings_fullscreen_title')} description={getString('settings_fullscreen_title_desc')}>
          <ToggleSwitch checked={fullscreenTitle} onChange={setFullscreenTitle} />
        </SettingItem>
        <SettingItem title={getString('settings_ambient_mode')} description={getString('settings_ambient_mode_desc')}>
          <div className="flex items-center gap-2.5">
            <AmbientModeIcon className={ambientMode ? 'text-primary' : 'text-chrome-neutral-500'} />
            <div ref={ambientIntensityWheelRef} className="flex items-center gap-2.5">
              <div className="w-24 sm:w-32">
                <Slider
                  aria-label={getString('settings_ambient_intensity')}
                  min={10}
                  max={100}
                  step={5}
                  value={ambientIntensity}
                  onChange={setAmbientIntensity}
                  disabled={!ambientMode}
                />
              </div>
              <span className="w-9 text-end font-mono text-xs text-chrome-neutral-400">{ambientIntensity}%</span>
            </div>
            <ToggleSwitch checked={ambientMode} onChange={setAmbientMode} />
          </div>
        </SettingItem>
        <SettingItem title={getString('settings_ambient_glow')} description={getString('settings_ambient_glow_desc')} disabled={!ambientMode}>
          <ToggleSwitch checked={ambientMode && ambientGlow} onChange={setAmbientGlow} disabled={!ambientMode} />
        </SettingItem>
        <SettingItem title={getString('settings_adaptive_player')} description={getString('settings_adaptive_player_desc')}>
          <ToggleSwitch checked={adaptiveSize} onChange={setAdaptiveSize} />
        </SettingItem>
        <SettingItem title={getString('settings_paid_promotion')} description={getString('settings_paid_promotion_desc')}>
          <ToggleSwitch checked={paidPromotion} onChange={setPaidPromotion} />
        </SettingItem>
        <SettingItem title={getString('settings_idle_progress')} description={getString('settings_idle_progress_desc')}>
          <ToggleSwitch checked={idleProgress} onChange={setIdleProgress} />
        </SettingItem>
        <SettingItem title={getString('settings_frame_step')} description={getString('settings_frame_step_desc')}>
          <ToggleSwitch checked={frameStep} onChange={setFrameStep} />
        </SettingItem>
      </SettingsGroup>

    </div>
  );
}
