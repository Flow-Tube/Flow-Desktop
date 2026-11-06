import React, { useEffect, useState } from "react";
import { Check, Copy, Info, RotateCcw } from "lucide-react";
import {
  DEFAULT_SB_COLORS,
  SPONSORBLOCK_CATEGORIES,
  useSettingsStore,
} from "../store/useSettingsStore";
import { SettingsGroup } from "../components/settings/SettingsGroup";
import { SettingItem } from "../components/settings/SettingItem";
import { ToggleSwitch } from "../components/ui/ToggleSwitch";
import { Select } from "../components/ui/Select";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/TextInput";
import { SponsorBlockCategoryRow } from "../components/extensions/SponsorBlockCategoryRow";
import { SponsorBlockStatsDashboard } from "../components/extensions/SponsorBlockStatsDashboard";
import { SB_CATEGORY_META } from "../lib/sponsorBlockCategories";
import { useSponsorBlockCategoryStats } from "../lib/useSponsorBlockCategoryStats";
import { SETTINGS } from "../lib/settings/schema";
import { copyText } from "../lib/clipboard";
import { confirmAction } from "../lib/dialogs";
import { getString } from "../lib/i18n/index";
import { isSettingDisabledUntilWired } from "../lib/settings/values";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
      {children}
    </h3>
  );
}

export const ExtensionsPage: React.FC = () => {
  const {
    loadSettings,
    sponsorBlockEnabled,
    setSponsorBlockEnabled,
    dearrowEnabled,
    setDeArrowEnabled,
    dearrowBadgeEnabled,
    setDeArrowBadgeEnabled,
    rytdEnabled,
    setRytdEnabled,
    discordMode,
    setDiscordMode,
    sponsorBlockColors,
    setCategoryColor,
    sponsorBlockActions,
    setCategoryAction,
    savedMinutes,
    segmentsSkipped,
    resetStats,
    serverUrl,
    setServerUrl,
    sbSubmitEnabled,
    setSbSubmitEnabled,
    sbUserId,
    setSbUserId,
  } = useSettingsStore();
  const submissionsDisabled = isSettingDisabledUntilWired(SETTINGS.SB_SUBMIT_ENABLED);
  const { stats: categoryStats } = useSponsorBlockCategoryStats(segmentsSkipped);

  const [localServerUrl, setLocalServerUrl] = useState(serverUrl);
  const [localUserId, setLocalUserId] = useState(sbUserId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setLocalServerUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    setLocalUserId(sbUserId);
  }, [sbUserId]);

  const handleResetStats = async () => {
    const confirmed = await confirmAction({
      title: getString('extensions_reset_stats_title'),
      message: getString('extensions_reset_stats_body'),
      icon: RotateCcw,
      confirmLabel: getString("reset"),
      destructive: true,
    });
    if (confirmed) void resetStats();
  };

  const handleCopyUserId = async () => {
    if (!localUserId) return;
    if (!(await copyText(localUserId))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateUserId = () => {
    if (submissionsDisabled) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const generated = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setLocalUserId(generated);
    void setSbUserId(generated);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 pb-20 md:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">
          {getString('extensions_title')}
        </h1>
        <p className="mt-1 text-sm text-chrome-neutral-400">
          {getString('extensions_description')}
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <section className="col-span-12">
          <SectionLabel>{getString('extensions_impact')}</SectionLabel>
          <SponsorBlockStatsDashboard
            savedMinutes={savedMinutes}
            segmentsSkipped={segmentsSkipped}
            categoryStats={categoryStats}
            colors={sponsorBlockColors}
            onReset={handleResetStats}
          />
        </section>

        <section className="col-span-12 lg:col-span-6">
          <SettingsGroup title={getString('extensions_integrations')}>
            <SettingItem
              title={getString('extensions_sponsor_block')}
              description={getString('extensions_sponsor_block_description')}
            >
              <ToggleSwitch checked={sponsorBlockEnabled} onChange={setSponsorBlockEnabled} />
            </SettingItem>
            <SettingItem
              title={getString('extensions_de_arrow')}
              description={getString('extensions_de_arrow_description')}
            >
              <ToggleSwitch checked={dearrowEnabled} onChange={setDeArrowEnabled} />
            </SettingItem>
            {dearrowEnabled && (
              <SettingItem
                title={getString('extensions_de_arrow_badge')}
                description={getString('extensions_de_arrow_badge_description')}
              >
                <ToggleSwitch checked={dearrowBadgeEnabled} onChange={setDeArrowBadgeEnabled} />
              </SettingItem>
            )}
            <SettingItem
              title={getString('extensions_return_dislike')}
              description={getString('extensions_return_dislike_description')}
            >
              <ToggleSwitch checked={rytdEnabled} onChange={setRytdEnabled} />
            </SettingItem>
            <SettingItem
              title={getString('discord_title')}
              description={getString('discord_description')}
            >
              <Select
                value={discordMode}
                onChange={(value) => void setDiscordMode(value as typeof discordMode)}
                options={[
                  { value: "off", label: getString('discord_mode_off') },
                  { value: "music", label: getString('discord_mode_music') },
                  { value: "videos", label: getString('discord_mode_videos') },
                  { value: "musicAndVideos", label: getString('discord_mode_music_and_videos') },
                ]}
              />
            </SettingItem>
          </SettingsGroup>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <SectionLabel>{getString('extensions_server_section')}</SectionLabel>
          <div className="overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
            <div className="space-y-2 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-chrome-neutral-200">{getString('extensions_api_server')}</div>
                <p className="mt-0.5 text-xs text-chrome-neutral-400">
                  {getString('extensions_api_server_description')}
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <TextInput
                  value={localServerUrl}
                  onChange={setLocalServerUrl}
                  onBlur={() => setServerUrl(localServerUrl)}
                  placeholder="https://sponsor.ajay.app"
                  className="flex-1"
                  inputMode="url"
                />
                <Button variant="secondary" onClick={() => setServerUrl(localServerUrl)}>
                  {getString('extensions_save')}
                </Button>
              </div>
            </div>

            <div className="border-t border-chrome-neutral-800/50">
              <SettingItem
                title={getString('extensions_submit_segments')}
                description={getString('extensions_submit_segments_description')}
                disabled={submissionsDisabled}
              >
                <ToggleSwitch
                  checked={sbSubmitEnabled}
                  onChange={setSbSubmitEnabled}
                  disabled={submissionsDisabled}
                />
              </SettingItem>
            </div>

            {sbSubmitEnabled && !submissionsDisabled && (
              <div className="space-y-3 border-t border-chrome-neutral-800/50 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-chrome-neutral-200">{getString('extensions_submission_id')}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyUserId}
                      disabled={!localUserId}
                      title={getString('extensions_copy_id')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-200 disabled:opacity-50"
                    >
                      {copied ? (
                        <Check size={14} className="text-[var(--color-primary)]" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <Button variant="ghost" size="sm" onClick={handleGenerateUserId}>
                      {getString('extensions_generate_id')}
                    </Button>
                  </div>
                </div>
                <TextInput
                  value={localUserId}
                  onChange={(value) => setLocalUserId(value.trim())}
                  onBlur={() => setSbUserId(localUserId)}
                  placeholder={getString('extensions_submission_id_placeholder')}
                  className="w-full font-mono text-xs"
                />
                <div className="flex items-start gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container p-3">
                  <Info size={14} className="mt-0.5 shrink-0 text-chrome-neutral-400" />
                  <p className="text-xs leading-relaxed text-chrome-neutral-400">
                    {getString('extensions_submission_id_note')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {sponsorBlockEnabled && (
          <section className="col-span-12">
            <SettingsGroup title={getString('extensions_segment_categories')}>
              {SPONSORBLOCK_CATEGORIES.map((category) => (
                <SponsorBlockCategoryRow
                  key={category}
                  name={SB_CATEGORY_META[category].name}
                  description={SB_CATEGORY_META[category].description}
                  isHighlight={category === "poi_highlight"}
                  color={sponsorBlockColors[category] ?? DEFAULT_SB_COLORS[category]}
                  action={sponsorBlockActions[category] ?? "skip"}
                  defaultColor={DEFAULT_SB_COLORS[category]}
                  onColorChange={(color) => void setCategoryColor(category, color)}
                  onActionChange={(action) => void setCategoryAction(category, action)}
                />
              ))}
            </SettingsGroup>
          </section>
        )}
      </div>
    </div>
  );
};

export default ExtensionsPage;
