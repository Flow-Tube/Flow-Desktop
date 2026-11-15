import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { SortableToggleList } from '../SortableToggleList';
import { Select } from '../../ui/Select';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import {
  MINI_BAR_BUTTONS,
  miniBarBackgroundOptions,
  miniBarButtonLabel,
  miniBarButtonLimit,
  miniBarProgressOptions,
  miniBarSwipeOptions,
  parseSwipeAction,
  miniBarTimeOptions,
  miniBarWidthOptions,
  miniCoverTapOptions,
  miniPlayerStyleOptions,
  serializeMiniBarButtons,
  useMiniPlayerLook,
  type MiniBarButton,
} from '../../../lib/music/miniPlayerLook';

/** The music mini player's style, paint and, for the Pill, its buttons in order. */
export function MusicMiniPlayerSettings() {
  const look = useMiniPlayerLook();
  const [, setStyle] = usePreference(SETTINGS.MUSIC_MINI_PLAYER_STYLE);
  const [, setBackground] = usePreference(SETTINGS.MINI_BAR_BACKGROUND);
  const [, setButtons] = usePreference(SETTINGS.MINI_BAR_BUTTONS);
  const [, setWidth] = usePreference(SETTINGS.MINI_BAR_WIDTH);
  const [, setRing] = usePreference(SETTINGS.MINI_COVER_RING);
  const [, setBarProgress] = usePreference(SETTINGS.MINI_BAR_PROGRESS);
  const [, setTime] = usePreference(SETTINGS.MINI_BAR_TIME);
  const [, setSungLine] = usePreference(SETTINGS.LYRICS_IN_MINI_PLAYER);
  const [, setCoverTap] = usePreference(SETTINGS.MINI_COVER_TAP);
  const [swipeLeft, setSwipeLeft] = usePreference(SETTINGS.MINI_BAR_SWIPE_LEFT_ACTION);
  const [swipeRight, setSwipeRight] = usePreference(SETTINGS.MINI_BAR_SWIPE_RIGHT_ACTION);
  const chosen = look.buttons;
  const limit = miniBarButtonLimit(look.width);
  // The chosen buttons first, in their order, then the rest to pick from.
  const order: string[] = [...chosen, ...MINI_BAR_BUTTONS.filter((button) => !chosen.includes(button))];
  const isChosen = (id: string) => chosen.includes(id as MiniBarButton);
  const save = (buttons: string[]) => setButtons(serializeMiniBarButtons(buttons as MiniBarButton[]));

  return (
    <SettingsGroup title={getString('settings_group_music_mini_player')}>
      <SettingItem title={getString('mini_player_style')} description={getString('mini_player_style_summary')}>
        <Select value={look.style} onChange={setStyle} options={miniPlayerStyleOptions()} />
      </SettingItem>
      <SettingItem title={getString('mini_bar_background')} description={getString('mini_bar_background_summary')}>
        <Select value={look.background} onChange={setBackground} options={miniBarBackgroundOptions()} />
      </SettingItem>
      <SettingItem title={getString('mini_bar_swipe_left')} description={getString('mini_bar_swipe_summary')}>
        <Select value={parseSwipeAction(swipeLeft)} onChange={setSwipeLeft} options={miniBarSwipeOptions()} />
      </SettingItem>
      <SettingItem title={getString('mini_bar_swipe_right')} description={getString('mini_bar_swipe_summary')}>
        <Select value={parseSwipeAction(swipeRight)} onChange={setSwipeRight} options={miniBarSwipeOptions()} />
      </SettingItem>
      {look.style === 'pill' && (
        <>
          <SettingItem title={getString('mini_bar_width')} description={getString('mini_bar_width_summary')}>
            <Select value={look.width} onChange={setWidth} options={miniBarWidthOptions()} />
          </SettingItem>
          <SettingItem title={getString('mini_cover_ring')} description={getString('mini_cover_ring_summary')}>
            <ToggleSwitch checked={look.coverRing} onChange={(on) => setRing(String(on))} />
          </SettingItem>
          <SettingItem title={getString('mini_bar_progress')} description={getString('mini_bar_progress_summary')}>
            <Select value={look.barProgress} onChange={setBarProgress} options={miniBarProgressOptions()} />
          </SettingItem>
          <SettingItem title={getString('mini_bar_time')} description={getString('mini_bar_time_summary')}>
            <Select value={look.time} onChange={setTime} options={miniBarTimeOptions()} />
          </SettingItem>
          <SettingItem title={getString('lyrics_in_mini_player')} description={getString('lyrics_in_mini_player_summary')}>
            <ToggleSwitch checked={look.sungLine} onChange={(on) => setSungLine(String(on))} />
          </SettingItem>
          <SettingItem title={getString('mini_cover_tap')} description={getString('mini_cover_tap_summary')}>
            <Select value={look.coverTap} onChange={setCoverTap} options={miniCoverTapOptions()} />
          </SettingItem>
          <SettingItem title={getString('mini_bar_buttons')} description={getString('mini_bar_buttons_summary')}>
            <span className="text-xs font-medium text-chrome-neutral-400">
              {getString('mini_bar_buttons_count', chosen.length, limit)}
            </span>
          </SettingItem>
          <SortableToggleList
            order={order}
            label={getString('mini_bar_buttons')}
            labelOf={(id) => miniBarButtonLabel(id as MiniBarButton)}
            statusOf={(_, enabled) => getString(enabled ? 'mini_bar_button_shown' : 'mini_bar_button_hidden')}
            isEnabled={isChosen}
            canEnable={() => chosen.length < limit}
            onReorder={(next) => save(next.filter(isChosen))}
            onToggle={(id, on) => save(on ? [...chosen, id] : chosen.filter((button) => button !== id))}
          />
        </>
      )}
    </SettingsGroup>
  );
}
