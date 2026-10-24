import { SettingsGroup } from '../SettingsGroup';
import { MusicTraySetting } from '../MusicTraySetting';
import { MusicAudioSettings } from '../music/MusicAudioSettings';
import { MusicLyricsSettings } from '../music/MusicLyricsSettings';
import { MusicNowPlayingSettings } from '../music/MusicNowPlayingSettings';
import { MusicPlaybackSettings } from '../music/MusicPlaybackSettings';
import { ScrobblingSection } from '../../scrobbling/ScrobblingSection';
import { getString } from '../../../lib/i18n/index';

/** Every music setting in one place, grouped the way Flow for Android groups them. */
export function MusicTab() {
  return (
    <div className="space-y-6 pb-8">
      <MusicPlaybackSettings />
      <MusicAudioSettings />
      <MusicNowPlayingSettings />
      <MusicLyricsSettings />
      <SettingsGroup title={getString('settings_group_music_integrations')}>
        <MusicTraySetting />
      </SettingsGroup>
      <ScrobblingSection />
    </div>
  );
}
