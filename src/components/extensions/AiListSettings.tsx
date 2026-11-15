import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";

import { SettingsGroup } from "../settings/SettingsGroup";
import { SettingItem } from "../settings/SettingItem";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import {
  AISLIST_HOMEPAGE,
  SOUL_OVER_AI_HOMEPAGE,
  SPOTIFY_AI_BLOCKER_REPO,
  disallowAiChannel,
  refreshAiList,
  saveAiListSource,
  setAiListBlockEnabled,
  setAiListWarnEnabled,
  setAiMusicBlockEnabled,
  setAiReportEnabled,
  setAiReportName,
  useAiListSource,
  useAiListStatus,
  useAiListSwitches,
  useAiReportSettings,
  useAllowedAiChannels,
} from "../../lib/aiList/useAiList";
import type { AiListStatus } from "../../lib/api/aiList";
import { getString } from "../../lib/i18n/index";
import { openExternal } from "../../lib/openExternal";
import { formatYouTubeRelativeTime } from "../../lib/publishedDate";

const UPDATED_JUST_NOW_MS = 60_000;

/** "60,669 channels and 1,204 artists, updated 3 hours ago", naming only the lists switched on. */
function statusText(status: AiListStatus | null): string {
  const channels = status?.channelCount;
  const artists = status?.artistCount;
  if (!status || (channels == null && artists == null)) return getString("ai_list_status_pending");
  const when = formatYouTubeRelativeTime(status.updatedAtMs);
  const now = Date.now() - status.updatedAtMs < UPDATED_JUST_NOW_MS;
  if (channels != null && artists != null) {
    const [c, a] = [channels.toLocaleString(), artists.toLocaleString()];
    return now ? getString("ai_lists_status_count_now", c, a) : getString("ai_lists_status_count", c, a, when);
  }
  if (artists != null) {
    const a = artists.toLocaleString();
    return now ? getString("ai_music_status_count_now", a) : getString("ai_music_status_count", a, when);
  }
  const c = (channels ?? 0).toLocaleString();
  return now ? getString("ai_list_status_count_now", c) : getString("ai_list_status_count", c, when);
}

function SourceEditor({ onDone }: { onDone: () => void }) {
  const source = useAiListSource();
  const [url, setUrl] = useState(source.url ?? "");
  const [key, setKey] = useState(source.key ?? "");
  const [invalid, setInvalid] = useState(false);
  const save = async (nextUrl: string, nextKey: string) => {
    if (await saveAiListSource(nextUrl, nextKey)) onDone();
    else setInvalid(true);
  };
  return (
    <div className="space-y-3 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low px-5 py-4">
      <p className="text-xs text-chrome-neutral-400">{getString("ai_list_source_dialog_body")}</p>
      <TextInput
        value={url}
        onChange={(value) => {
          setUrl(value);
          setInvalid(false);
        }}
        placeholder={getString("ai_list_source_url_placeholder")}
        aria-label={getString("ai_list_source_url_hint")}
        inputMode="url"
        className="w-full"
      />
      <TextInput
        value={key}
        onChange={(value) => {
          setKey(value);
          setInvalid(false);
        }}
        placeholder={getString("ai_list_source_key_hint")}
        aria-label={getString("ai_list_source_key_hint")}
        className="w-full font-mono"
      />
      <p className={`text-xs ${invalid ? "text-chrome-red-400" : "text-chrome-neutral-500"}`}>
        {getString(invalid ? "ai_list_source_invalid" : "ai_list_source_key_help")}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => void save("", "")}>
          {getString("ai_list_source_reset")}
        </Button>
        <Button onClick={() => void save(url.trim(), key.trim())}>{getString("save")}</Button>
      </div>
    </div>
  );
}

/**
 * The AI lists and reporting, as on Android: hide listed channels, label suspected ones, hide AI
 * music, the lists' state and source, channels and artists let back in, and the submitter name.
 */
export function AiListSettings() {
  const { blockEnabled, warnEnabled, musicEnabled, isOn } = useAiListSwitches();
  const { status, refreshing } = useAiListStatus();
  const source = useAiListSource();
  const allowed = useAllowedAiChannels();
  const report = useAiReportSettings();
  const [editingSource, setEditingSource] = useState(false);
  const [name, setName] = useState(report.name);
  useEffect(() => setName(report.name), [report.name]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SettingsGroup title={getString("ai_list_title")}>
          <SettingItem title={getString("ai_list_block_title")} description={getString("ai_list_block_summary")}>
            <ToggleSwitch checked={blockEnabled} onChange={(on) => void setAiListBlockEnabled(on)} />
          </SettingItem>
          <SettingItem title={getString("ai_list_warn_title")} description={getString("ai_list_warn_summary")}>
            <ToggleSwitch checked={warnEnabled} onChange={(on) => void setAiListWarnEnabled(on)} />
          </SettingItem>
          <SettingItem title={getString("ai_music_block_title")} description={getString("ai_music_block_summary")}>
            <ToggleSwitch checked={musicEnabled} onChange={(on) => void setAiMusicBlockEnabled(on)} />
          </SettingItem>
          {isOn && (
            <SettingItem title={getString("ai_list_status_title")} description={statusText(status)}>
              <Button variant="secondary" disabled={refreshing} onClick={() => void refreshAiList()} aria-label={getString("refresh")}>
                <RotateCcw size={15} className={refreshing ? "animate-spin" : undefined} />
                {getString("refresh")}
              </Button>
            </SettingItem>
          )}
          <SettingItem
            title={getString("ai_list_source_title")}
            description={source.isDefault ? getString("ai_list_source_default") : source.host}
          >
            <Button variant="secondary" onClick={() => setEditingSource((open) => !open)} aria-expanded={editingSource}>
              {getString("ai_list_source_change")}
            </Button>
          </SettingItem>
          <SettingItem title={getString("ai_list_attribution_title")} description={getString("ai_list_attribution_summary")}>
            <Button variant="ghost" onClick={() => void openExternal(AISLIST_HOMEPAGE)} aria-label={getString("ai_list_attribution_title")}>
              <ExternalLink size={16} />
            </Button>
          </SettingItem>
          {musicEnabled && (
            <>
              <SettingItem title={getString("ai_music_attribution_soul_title")} description={getString("ai_music_attribution_soul_summary")}>
                <Button variant="ghost" onClick={() => void openExternal(SOUL_OVER_AI_HOMEPAGE)} aria-label={getString("ai_music_attribution_soul_title")}>
                  <ExternalLink size={16} />
                </Button>
              </SettingItem>
              <SettingItem title={getString("ai_music_attribution_blocker_title")} description={getString("ai_music_attribution_blocker_summary")}>
                <Button variant="ghost" onClick={() => void openExternal(SPOTIFY_AI_BLOCKER_REPO)} aria-label={getString("ai_music_attribution_blocker_title")}>
                  <ExternalLink size={16} />
                </Button>
              </SettingItem>
            </>
          )}
        </SettingsGroup>
        {editingSource && <SourceEditor onDone={() => setEditingSource(false)} />}
        <p className="px-1 text-xs text-chrome-neutral-500">{getString("ai_list_footer")}</p>
      </div>

      {allowed.length > 0 && (
        <SettingsGroup title={getString("ai_list_allowed_header")}>
          {allowed.map((channel) => (
            <SettingItem key={channel.id} title={channel.name} description={channel.handle ? `@${channel.handle.replace(/^@/, "")}` : undefined}>
              <Button variant="secondary" onClick={() => void disallowAiChannel(channel.id)} aria-label={getString("ai_list_hide_again_item", channel.name)}>
                {getString("ai_list_hide_again")}
              </Button>
            </SettingItem>
          ))}
        </SettingsGroup>
      )}

      <div className="space-y-2">
        <SettingsGroup title={getString("ai_report_header")}>
          <SettingItem title={getString("ai_report_enabled_title")} description={getString("ai_report_enabled_summary")}>
            <ToggleSwitch checked={report.enabled} onChange={(on) => void setAiReportEnabled(on)} />
          </SettingItem>
          <SettingItem title={getString("ai_report_name_title")} description={getString("ai_report_name_dialog_body")} disabled={!report.enabled}>
            <TextInput
              value={name}
              onChange={setName}
              onBlur={() => void setAiReportName(name.trim())}
              placeholder={getString("ai_report_name_unset")}
              aria-label={getString("ai_report_name_hint")}
              disabled={!report.enabled}
              className="w-44"
            />
          </SettingItem>
        </SettingsGroup>
        <p className="px-1 text-xs text-chrome-neutral-500">{getString("ai_report_footer")}</p>
      </div>
    </div>
  );
}
