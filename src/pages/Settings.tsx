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

const tabComponents: Record<SettingsCategory, React.FC> = {
  appearance: AppearanceTab,
  profiles: ProfilesTab,
  player: PlayerTab,
  music: MusicTab,
  content: ContentTab,
  taste: TasteTab,
  quality: QualityTab,
  network: NetworkTab,
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
