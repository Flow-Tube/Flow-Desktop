import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Globe, Scale, Code2, Cpu, Monitor, User, Package, Fingerprint, Info, RefreshCw } from 'lucide-react';
import { SettingsGroup } from '../SettingsGroup';
import Logo from '../../common/Logo';
import { Button } from '../../ui/Button';
import { ToggleSwitch } from '../../ui/ToggleSwitch';
import { getString } from '../../../lib/i18n/index';
import { openExternal } from '../../../lib/openExternal';
import { getAppMetadata, type AppMetadata } from '../../../lib/appMetadata';
import { getSystemMetadata, type SystemMetadata } from '../../../lib/systemMetadata';
import { useUpdaterStore } from '../../../store/useUpdaterStore';
import { useUiStore } from '../../../store/useUiStore';

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

function RedditIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="nonzero" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0zM16.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595zM8.303 11.575c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841zM15.709 11.575c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797zM12.006 15.588c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135z" />
    </svg>
  );
}

function PatreonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M14.82 2.41c3.96 0 7.18 3.24 7.18 7.21 0 3.96-3.22 7.18-7.18 7.18-3.97 0-7.21-3.22-7.21-7.18 0-3.97 3.24-7.21 7.21-7.21zM2 21.6h3.5V2.41H2V21.6z" />
    </svg>
  );
}

function LinkRow({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) {
  return (
    <div
      onClick={href ? () => openExternal(href) : undefined}
      className={`flex items-center justify-between px-5 py-4 hover:bg-surface-container transition-colors duration-200 ease-out group ${href ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-3 shrink-0 pr-4">
        <span className="text-chrome-neutral-400">{icon}</span>
        <span className="text-sm font-medium text-chrome-neutral-200">{label}</span>
      </div>
      <div className="flex items-center justify-end gap-2 min-w-0 text-right">
        {value && <span className="text-sm text-chrome-neutral-400 break-all">{value}</span>}
        {href && <ExternalLink size={12} className="text-chrome-neutral-500 group-hover:text-chrome-neutral-300 transition-colors" />}
      </div>
    </div>
  );
}

const unknown = () => getString('settings_unknown');

const sourceLabel = (source?: AppMetadata['source'] | SystemMetadata['source']) => {
  if (source === 'tauri' || source === 'tauri-os') return getString('settings_source_tauri');
  if (source === 'fallback' || source === 'browser-fallback') return getString('settings_source_fallback');
  return unknown();
};

export function AboutTab() {
  const [appMetadata, setAppMetadata] = useState<AppMetadata | null>(null);
  const [systemMetadata, setSystemMetadata] = useState<SystemMetadata | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const autoCheck = useUpdaterStore((s) => s.autoCheck);
  const setAutoCheck = useUpdaterStore((s) => s.setAutoCheck);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    let active = true;
    Promise.all([getAppMetadata(), getSystemMetadata()])
      .then(([app, system]) => {
        if (!active) return;
        setAppMetadata(app);
        setSystemMetadata(system);
      })
      .catch(() => {
        if (!active) return;
        setAppMetadata(null);
        setSystemMetadata(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void useUpdaterStore.getState().loadPreferences();
  }, []);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdates({ silent: false });
      if (result === 'uptodate') {
        showToast({ variant: 'success', message: getString('updater_up_to_date') });
      } else if (result === 'error') {
        showToast({ variant: 'error', message: getString('updater_check_failed') });
      }
      // 'available' opens the global UpdateDialog automatically.
    } finally {
      setCheckingUpdate(false);
    }
  };

  const appName = appMetadata?.name ?? getString('settings_loading_metadata');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col items-center py-8">
        <Logo size={72} />
        <h2 className="text-2xl font-bold text-chrome-neutral-100 mt-4">{appName}</h2>
        <p className="text-sm text-chrome-neutral-400 mt-1">{getString('settings_about_subtitle')}</p>
      </div>

      <SettingsGroup title={getString('settings_group_app')}>
        <LinkRow icon={<Code2 size={16} />} label={getString('settings_version')} value={appMetadata?.version ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Fingerprint size={16} />} label={getString('settings_identifier')} value={appMetadata?.identifier ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_tauri_version')} value={appMetadata?.tauriVersion ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Package size={16} />} label={getString('settings_bundle_type')} value={appMetadata?.bundleType ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Info size={16} />} label={getString('settings_metadata_source')} value={sourceLabel(appMetadata?.source)} />
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_updates')}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex-1 min-w-0 mr-4">
            <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_check_for_updates')}</div>
            <div className="text-xs text-chrome-neutral-400 mt-0.5">
              {getString('settings_check_for_updates_desc', appMetadata?.version ?? unknown())}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={handleCheckForUpdates} disabled={checkingUpdate}>
            <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : undefined} />
            {checkingUpdate ? getString('settings_checking') : getString('settings_check_for_updates')}
          </Button>
        </div>
        <div className="border-t border-chrome-neutral-800/50" />
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex-1 min-w-0 mr-4">
            <div className="text-sm font-medium text-chrome-neutral-200">{getString('settings_auto_update')}</div>
            <div className="text-xs text-chrome-neutral-400 mt-0.5">{getString('settings_auto_update_desc')}</div>
          </div>
          <ToggleSwitch checked={autoCheck} onChange={(value) => void setAutoCheck(value)} />
        </div>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_contact')}>
        <LinkRow icon={<Globe size={16} />} label={getString('settings_website')} value="flow.aedev.me" href="https://flow.aedev.me" />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<GithubIcon />} label={getString('settings_github')} value="A-EDev/flow-desktop" href="https://github.com/Flow-Tube/Flow-Desktop" />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<RedditIcon />} label={getString('settings_reddit')} value="r/Flow_Official" href="https://reddit.com/r/Flow_Official" />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<User size={16} />} label={getString('settings_creator')} value="A-EDev" href="https://github.com/A-EDev" />
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_support')}>
        <LinkRow icon={<PatreonIcon />} label={getString('settings_donate_patreon')} value="" href="https://patreon.com/A_EDev" />
        <div className="border-t border-chrome-neutral-800/50" />
        <div className="px-5 py-4">
          <p className="text-xs text-chrome-neutral-400 leading-relaxed">{getString('settings_donate_patreon_desc')}</p>
        </div>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_legal')}>
        <LinkRow icon={<Scale size={16} />} label={getString('settings_license')} value="GPL-3.0" />
        <div className="border-t border-chrome-neutral-800/50" />
        <div className="px-5 py-4">
          <p className="text-xs text-chrome-neutral-400 leading-relaxed">{getString('settings_license_text')}</p>
        </div>
      </SettingsGroup>

      <SettingsGroup title={getString('settings_group_device')}>
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_platform')} value={systemMetadata?.platform ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_os')} value={systemMetadata ? `${systemMetadata.osType} ${systemMetadata.osVersion}` : unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_os_family')} value={systemMetadata?.family ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_architecture')} value={systemMetadata?.arch ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Globe size={16} />} label={getString('settings_locale')} value={systemMetadata?.locale ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Monitor size={16} />} label={getString('settings_display')} value={systemMetadata?.display ?? unknown()} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Info size={16} />} label={getString('settings_metadata_source')} value={sourceLabel(systemMetadata?.source)} />
        <div className="border-t border-chrome-neutral-800/50" />
        <LinkRow icon={<Cpu size={16} />} label={getString('settings_user_agent')} value={systemMetadata?.userAgent ?? unknown()} />
      </SettingsGroup>
    </div>
  );
}
