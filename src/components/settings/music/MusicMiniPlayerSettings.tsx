import { SettingsGroup } from '../SettingsGroup';
import { SettingItem } from '../SettingItem';
import { SortableToggleList } from '../SortableToggleList';
import { Select } from '../../ui/Select';
import { usePreference } from '../../../lib/usePreference';
import { getString } from '../../../lib/i18n/index';
import { SETTINGS } from '../../../lib/settings/schema';
import {
  MAX_MINI_BAR_BUTTONS,
  MINI_BAR_BUTTONS,
  miniBarBackgroundOptions,
  miniBarButtonLabel,
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
  const chosen = look.buttons;
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
      {look.style === 'pill' && (
        <>
          <SettingItem title={getString('mini_bar_buttons')} description={getString('mini_bar_buttons_summary')}>
            <span className="text-xs font-medium text-chrome-neutral-400">
              {getString('mini_bar_buttons_count', chosen.length, MAX_MINI_BAR_BUTTONS)}
            </span>
          </SettingItem>
          <SortableToggleList
            order={order}
            label={getString('mini_bar_buttons')}
            labelOf={(id) => miniBarButtonLabel(id as MiniBarButton)}
            statusOf={(_, enabled) => getString(enabled ? 'mini_bar_button_shown' : 'mini_bar_button_hidden')}
            isEnabled={isChosen}
            canEnable={() => chosen.length < MAX_MINI_BAR_BUTTONS}
            onReorder={(next) => save(next.filter(isChosen))}
            onToggle={(id, on) => save(on ? [...chosen, id] : chosen.filter((button) => button !== id))}
          />
        </>
      )}
    </SettingsGroup>
  );
}
