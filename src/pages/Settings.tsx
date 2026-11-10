import { SettingsLayout, type SettingsCategory } from '../components/settings/SettingsLayout';
import { PlayerTab } from '../components/settings/tabs/PlayerTab';
import { MusicTab } from '../components/settings/tabs/MusicTab';
import { ContentTab } from '../components/settings/tabs/ContentTab';
import { TasteTab } from '../components/settings/tabs/TasteTab';
import { QualityTab } from '../components/settings/tabs/QualityTab';
import { NetworkTab } from '../components/settings/tabs/NetworkTab';
import { DownloadsTab } from '../components/settings/tabs/DownloadsTab';
import { DataTab } from '../components/settings/tabs/DataTab';
import { AboutTab } from '../components/settings/tabs/AboutTab';
import { AppearanceTab } from '../components/settings/tabs/AppearanceTab';
import { ProfilesTab } from '../components/settings/tabs/ProfilesTab';
import { KeyboardTab } from '../components/settings/tabs/KeyboardTab';
import { LyricsTab } from '../components/settings/tabs/LyricsTab';
import { SubscriptionsTab } from '../components/settings/tabs/SubscriptionsTab';
import { PrivacyTab } from '../components/settings/tabs/PrivacyTab';
import { WellbeingTab } from '../components/settings/tabs/WellbeingTab';
import { LanguageTab } from '../components/settings/tabs/LanguageTab';

const tabComponents: Record<SettingsCategory, React.FC> = {
  appearance: AppearanceTab,
  profiles: ProfilesTab,
  player: PlayerTab,
  keyboard: KeyboardTab,
  music: MusicTab,
  lyrics: LyricsTab,
  content: ContentTab,
  subscriptions: SubscriptionsTab,
  privacy: PrivacyTab,
  wellbeing: WellbeingTab,
  taste: TasteTab,
  quality: QualityTab,
  network: NetworkTab,
  language: LanguageTab,
  downloads: DownloadsTab,
  data: DataTab,
  about: AboutTab,
};

export const Settings: React.FC = () => {
  return (
    <SettingsLayout>
      {(activeTab) => {
        const TabComponent = tabComponents[activeTab];
        return <TabComponent />;
      }}
    </SettingsLayout>
  );
};

export default Settings;
