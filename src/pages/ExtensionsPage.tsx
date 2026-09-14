import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Info } from "lucide-react";
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

  const { t } = useTranslation("settings");
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

  const handleResetStats = () => {
    if (
      confirm("Reset SponsorBlock statistics? This clears your saved-time and skipped-segment counts.")
    ) {
      void resetStats();
    }
  };

  const handleCopyUserId = () => {
    if (!localUserId) return;
    void navigator.clipboard.writeText(localUserId);
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
          Extensions &amp; integrations
        </h1>
        <p className="mt-1 text-sm text-chrome-neutral-400">
          Crowdsourced enhancements from the FOSS community — SponsorBlock skips, DeArrow titles, and Return
          YouTube Dislike.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-4 md:gap-6">
        <section className="col-span-12">
          <SectionLabel>Your SponsorBlock impact</SectionLabel>
          <SponsorBlockStatsDashboard
            savedMinutes={savedMinutes}
            segmentsSkipped={segmentsSkipped}
            categoryStats={categoryStats}
            colors={sponsorBlockColors}
            onReset={handleResetStats}
          />
        </section>

        <section className="col-span-12 lg:col-span-6">
          <SettingsGroup title="Integrations">
            <SettingItem
              title="SponsorBlock"
              description="Automatically skip sponsored and promotional segments."
            >
              <ToggleSwitch checked={sponsorBlockEnabled} onChange={setSponsorBlockEnabled} />
            </SettingItem>
            <SettingItem
              title="DeArrow"
              description="Replace clickbait titles and thumbnails with crowdsourced ones."
            >
              <ToggleSwitch checked={dearrowEnabled} onChange={setDeArrowEnabled} />
            </SettingItem>
            {dearrowEnabled && (
              <SettingItem
                title="DeArrow indicators"
                description="Show a small badge next to titles cleaned by DeArrow."
              >
                <ToggleSwitch checked={dearrowBadgeEnabled} onChange={setDeArrowBadgeEnabled} />
              </SettingItem>
            )}
            <SettingItem
              title="Return YouTube Dislike"
              description="Fetch and display estimated public dislike counts."
            >
              <ToggleSwitch checked={rytdEnabled} onChange={setRytdEnabled} />
            </SettingItem>
            <SettingItem
              title={t("discord.title")}
              description={t("discord.description")}
            >
              <Select
                value={discordMode}
                onChange={(value) => void setDiscordMode(value as typeof discordMode)}
                options={[
                  { value: "off", label: t("discord.modeOff") },
                  { value: "music", label: t("discord.modeMusic") },
                  { value: "videos", label: t("discord.modeVideos") },
                  { value: "musicAndVideos", label: t("discord.modeMusicAndVideos") },
                ]}
              />
            </SettingItem>
          </SettingsGroup>
        </section>

        <section className="col-span-12 lg:col-span-6">
          <SectionLabel>Server &amp; contributions</SectionLabel>
          <div className="overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface-container-low">
            <div className="space-y-2 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-chrome-neutral-200">API server</div>
                <p className="mt-0.5 text-xs text-chrome-neutral-400">
                  Endpoint used to fetch and submit skip segments.
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
                  Save
                </Button>
              </div>
            </div>

            <div className="border-t border-chrome-neutral-800/50">
              <SettingItem
                title="Submit skipped segments"
                description="Show a submit button in the player and contribute segments."
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
                  <div className="text-sm font-medium text-chrome-neutral-200">Your submission ID</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyUserId}
                      disabled={!localUserId}
                      title="Copy ID"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-200 disabled:opacity-50"
                    >
                      {copied ? (
                        <Check size={14} className="text-[var(--color-primary)]" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <Button variant="ghost" size="sm" onClick={handleGenerateUserId}>
                      Generate
                    </Button>
                  </div>
                </div>
                <TextInput
                  value={localUserId}
                  onChange={(value) => setLocalUserId(value.trim())}
                  onBlur={() => setSbUserId(localUserId)}
                  placeholder="No ID set — generate or paste one"
                  className="w-full font-mono text-xs"
                />
                <div className="flex items-start gap-2 rounded-lg border border-chrome-neutral-800 bg-surface-container p-3">
                  <Info size={14} className="mt-0.5 shrink-0 text-chrome-neutral-400" />
                  <p className="text-xs leading-relaxed text-chrome-neutral-400">
                    Your ID is a random string that anonymously credits your submissions. Keep it private.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {sponsorBlockEnabled && (
          <section className="col-span-12">
            <SettingsGroup title="Segment categories">
              {SPONSORBLOCK_CATEGORIES.map((category) => (
                <SponsorBlockCategoryRow
                  key={category}
                  name={SB_CATEGORY_META[category].name}
                  description={SB_CATEGORY_META[category].description}
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
