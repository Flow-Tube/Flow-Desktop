import { useState, type ReactNode } from 'react';
import {
  PlayCircle,
  LayoutGrid,
  Heart,
  Gauge,
  Wifi,
  Download,
  Database,
  Info,
  Palette,
  Music2,
} from 'lucide-react';
import { getString } from '../../lib/i18n/index';

export type SettingsCategory =
  | 'appearance'
  | 'player'
  | 'music'
  | 'content'
  | 'taste'
  | 'quality'
  | 'network'
  | 'downloads'
  | 'data'
  | 'about';

interface CategoryDef {
  id: SettingsCategory;
  labelKey: Parameters<typeof getString>[0];
  icon: ReactNode;
}

const categories: CategoryDef[] = [
  { id: 'appearance', labelKey: 'settings_appearance', icon: <Palette size={18} /> },
  { id: 'player', labelKey: 'settings_player', icon: <PlayCircle size={18} /> },
  { id: 'music', labelKey: 'settings_music', icon: <Music2 size={18} /> },
  { id: 'content', labelKey: 'settings_content_ui', icon: <LayoutGrid size={18} /> },
  { id: 'taste', labelKey: 'settings_taste', icon: <Heart size={18} /> },
  { id: 'quality', labelKey: 'settings_quality_codecs', icon: <Gauge size={18} /> },
  { id: 'network', labelKey: 'settings_network_buffer', icon: <Wifi size={18} /> },
  { id: 'downloads', labelKey: 'settings_downloads', icon: <Download size={18} /> },
  { id: 'data', labelKey: 'settings_data_backup', icon: <Database size={18} /> },
  { id: 'about', labelKey: 'settings_about', icon: <Info size={18} /> },
];

interface SettingsLayoutProps {
  children: (activeTab: SettingsCategory) => ReactNode;
}

export function SettingsLayout({ children }: SettingsLayoutProps) {
  const [activeTab, setActiveTab] = useState<SettingsCategory>('appearance');

  return (
    <div className="mx-auto w-full h-[calc(100vh-64px)] flex">
      <nav className="w-56 shrink-0 border-r border-chrome-neutral-800 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        <h2 className="text-lg font-bold text-chrome-neutral-100 px-3 mb-4">{getString('settings_title')}</h2>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            className={`px-4 py-2.5 rounded-full flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer ${
              activeTab === cat.id
                ? 'bg-surface-container-high text-[var(--color-primary)]'
                : 'text-chrome-neutral-400 hover:bg-surface-container-low hover:text-chrome-neutral-200'
            }`}
          >
            {cat.icon}
            {getString(cat.labelKey)}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto py-6 pl-10 pr-4 scrollbar-none">
        {children(activeTab)}
      </div>
    </div>
  );
}
