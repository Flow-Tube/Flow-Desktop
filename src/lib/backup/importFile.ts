import { ArchiveRestore } from "lucide-react";
import { getSetting, setSetting, addWatchRecordsBulk } from "../api/db";
import { readBackupFile, type UnreadableReason } from "../api/backup";
import { bootstrapFromHistory, bootstrapFromSubscriptions, importBrain } from "../api/recommendation";
import { parseSubscriptionExport } from "../api/youtube";
import { confirmAction } from "../dialogs";
import {
  convertFlowNeuroBrainData,
  extractFlowNeuroBrainCandidate,
  isFlowNeuroBrainCandidate,
} from "../flowNeuroImport";
import { getString, type StringKey } from "../i18n/index";
import { profileDisplayName } from "../profiles/display";
import {
  extractBackupCollections,
  importBackupCollections,
  validateSettingsBackup,
  type BackupCollections,
} from "../settings/backup";
import { isProfilesMaster, restoreMasterProfiles } from "../settings/masterRestore";
import { SETTINGS, SETTING_SCOPES, type SettingKey } from "../settings/schema";
import { activeProfile } from "../storage/profileStorage";
import { setSettingValue } from "../../store/useAppSettingsStore";
import { useHistoryStore } from "../../store/useHistoryStore";
import { useProfilesStore } from "../../store/useProfilesStore";
import { useSubscriptionStore } from "../../store/useSubscriptionStore";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";
import type { WatchHistoryRecord } from "../../types/db";
import { importFailureMessage, importReportSummary, runOtherAppImport } from "./otherAppImport";
import { refreshAfterRestore } from "./refreshAfterRestore";
import {
  parseFreeTubeWatchHistory,
  parseHtmlWatchHistory,
  parseJsonSubscriptions,
  parseJsonWatchHistory,
  type ParsedChannel,
} from "./legacyImportParsers";

/** What to take from the file. */
export interface ImportSelection {
  settings: boolean;
  subscriptions: boolean;
  playlists: boolean;
  history: boolean;
  likes: boolean;
  notes: boolean;
  neuro: boolean;
}

export const IMPORT_EVERYTHING: ImportSelection = {
  settings: true,
  subscriptions: true,
  playlists: true,
  history: true,
  likes: true,
  notes: true,
  neuro: true,
};

export interface ImportCounts {
  subscriptions: number;
  playlists: number;
  history: number;
  likes: number;
  settings: number;
  neuro: boolean;
}

export type ImportStage = "reading" | "parsing" | "saving";

export interface ImportProgress {
  stage: ImportStage;
  percent: number;
  message: string;
}

export type ImportFileResult = { type: "done"; counts: ImportCounts } | { type: "cancelled" };

/** The file pickers' filter: every format `importFile` reads. */
export const IMPORT_FILE_EXTENSIONS = ["zip", "json", "db", "xml", "opml", "csv", "txt", "html"];

const UNREADABLE_MESSAGES: Record<UnreadableReason, StringKey> = {
  too_large: "import_error_too_large",
  no_backup: "import_error_no_backup",
  damaged: "import_error_damaged",
};

interface LocalPlaylist { id: string; name: string; description?: string; tracks: VideoSummary[]; }

/**
 * Imports a picked file: a Flow backup from either app (every profile, settings, collections and
 * brains), another app's export, or a plain subscription list. Throws an `Error` whose message
 * is ready to show.
 */
export async function importFile(
  path: string,
  selection: ImportSelection,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportFileResult> {
  let stage: ImportStage = "reading";
  let percent = 0;
  let message = "";
  const report = (next: Partial<ImportProgress>) => {
    stage = next.stage ?? stage;
    percent = next.percent ?? percent;
    message = next.message ?? message;
    onProgress({ stage, percent, message });
  };
  const counts: ImportCounts = { subscriptions: 0, playlists: 0, history: 0, likes: 0, settings: 0, neuro: false };

  report({ stage: "reading", percent: 15, message: getString("import_reading") });
  const read = await readBackupFile(path);
  if (read.type === "unreadable") throw new Error(getString(UNREADABLE_MESSAGES[read.reason]));
  if (read.type === "external") {
    report({ stage: "saving", percent: 60, message: getString("import_writing") });
    const outcome = await runOtherAppImport(read.kind, [path]);
    if (outcome.type === "failed") throw new Error(importFailureMessage(outcome.reason));
    counts.subscriptions = outcome.report.subscriptions;
    counts.history = outcome.report.history;
    counts.playlists = outcome.report.playlists;
    counts.likes = outcome.report.likes;
    report({ percent: 100 });
    useUiStore.getState().showToast({ message: importReportSummary(outcome.report), variant: "success" });
    return { type: "done", counts };
  }
  report({ stage: "parsing", percent: 40, message: getString("import_parsing") });
  const text = read.type === "text" ? read.text : "{}";
  let backupData: any = read.type === "backup" ? read.data : null;
  if (!text?.trim()) throw new Error(getString("import_error_empty_backup"));
  const trimmed = text.trim();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const isHtml = trimmed.toLowerCase().includes("<html") || trimmed.toLowerCase().includes("<!doctype html");
  if (isJson && !backupData) { try { backupData = JSON.parse(text); } catch { if (trimmed.includes("\n")) { backupData = { isFreeTubeHistory: true, rawText: text }; } else { throw new Error(getString("import_error_invalid_json")); } } }

  report({ stage: "saving", percent: 60, message: getString("import_writing") });

  if (isJson && backupData && isProfilesMaster(backupData)) {
    // Every profile in the backup: the ones not running are restored into their own
    // databases; the running one continues through the import below.
    report({ message: getString("import_restoring_profiles") });
    const { running, restoredElsewhere } = await restoreMasterProfiles(backupData);
    backupData = { schemaVersion: 2, settings: running?.settings ?? {}, collections: running?.collections ?? {} };
    if (restoredElsewhere > 0) {
      useUiStore.getState().showToast({ message: getString("import_profiles_restored", restoredElsewhere), variant: "success" });
    }
    void useProfilesStore.getState().load();
  } else if (isJson && backupData?.scope === "MASTER") {
    const profiles = useProfilesStore.getState().view;
    const running = profiles?.profiles.find((profile) => profile.id === profiles.activeId);
    if (profiles && running && profiles.profiles.length > 1) {
      const proceed = await confirmAction({
        title: getString("import_old_master_title", profileDisplayName(running)),
        message: getString("import_old_master_body"),
        icon: ArchiveRestore,
        confirmLabel: getString("restore"),
      });
      if (!proceed) return { type: "cancelled" };
    }
  }

  const settingsBackup = isJson && backupData ? validateSettingsBackup(backupData) : null;
  // Device settings (folders, proxy, quality, region) belong to the whole computer: only
  // Default restores them, so restoring into another profile can't change them.
  const restoresDeviceSettings = activeProfile().isDefault;
  const settingsEntries = settingsBackup
    ? (Object.entries(settingsBackup.settings) as [SettingKey, string][]).filter(
        ([key]) => restoresDeviceSettings || SETTING_SCOPES[key] !== "device",
      )
    : [];
  if (selection.settings && settingsEntries.length > 0) {
    report({ message: getString("import_importing_settings", settingsEntries.length) });
    for (const [key, value] of settingsEntries) {
      if (await setSettingValue(key, value)) counts.settings++;
      report({ percent: 60 + Math.round((counts.settings / settingsEntries.length) * 8) });
    }
  }

  // Flow v2 backup: restore the full-fidelity collections (watch history, brains,
  // likes, playlists, subscriptions) through the backend sync apply pipeline. On
  // failure fall back to the legacy fuzzy parsers below rather than aborting.
  let restoredViaCollections = false;
  const backupCollections = isJson && backupData ? extractBackupCollections(backupData) : null;
  if (backupCollections) {
    const collectionAllowed = (key: string): boolean => {
      switch (key) {
        case "watch_history":
        case "recap_stats": return selection.history;
        case "flow_neuro_brain":
        case "music_brain": return selection.neuro;
        case "subscriptions":
        case "subscription_channels": return selection.subscriptions;
        case "playlists": return selection.playlists;
        case "likes": return selection.likes;
        case "notes": return selection.notes;
        case "settings": return selection.settings;
        default: return false;
      }
    };
    const selected: BackupCollections = {};
    for (const [key, records] of Object.entries(backupCollections)) {
      if (collectionAllowed(key)) selected[key] = records;
    }
    if (Object.keys(selected).length > 0) {
      report({ percent: 68, message: getString("import_restoring_collections") });
      try {
        const summary = await importBackupCollections(selected);
        restoredViaCollections = true;
        const restoredOf = (name: string) => {
          const stat = summary.collections.find((s) => s.collection === name);
          return stat ? stat.added + stat.updated : 0;
        };
        counts.history = restoredOf("watch_history");
        counts.subscriptions = restoredOf("subscription_channels") + restoredOf("subscriptions");
        counts.playlists = restoredOf("playlists");
        counts.likes = restoredOf("likes");
        if (restoredOf("flow_neuro_brain") + restoredOf("music_brain") > 0) counts.neuro = true;
        report({ percent: 90 });
        await refreshAfterRestore();
      } catch (err) {
        console.error("Backend collection restore failed; falling back to legacy parsing", err);
      }
    }
  }

  let brainToImport: unknown | null = null;
  if (isJson && backupData) brainToImport = extractFlowNeuroBrainCandidate(backupData);
  if (selection.neuro && brainToImport && isFlowNeuroBrainCandidate(brainToImport)) {
    report({ message: getString("import_importing_neuro") });
    await importBrain(convertFlowNeuroBrainData(brainToImport));
    counts.neuro = true;
  }

  if (selection.subscriptions && !restoredViaCollections) {
    let parsedSubs: ParsedChannel[] = [];
    if (isJson && backupData && !backupData.isFreeTubeHistory) parsedSubs = parseJsonSubscriptions(backupData);
    else if (!isJson && !isHtml) { const arr = await parseSubscriptionExport(text); parsedSubs = arr.map(([id, name]) => ({ id, name })); }
    if (parsedSubs.length > 0) {
      report({ message: getString("import_importing_subs", parsedSubs.length) });
      const { subscribe } = useSubscriptionStore.getState();
      for (const sub of parsedSubs) {
        await subscribe(sub.id, sub.name);
        counts.subscriptions++;
        report({ percent: 60 + Math.round((counts.subscriptions / parsedSubs.length) * 15) });
      }
      await bootstrapFromSubscriptions(parsedSubs.map((sub) => sub.name).filter(Boolean));
    }
  }

  if (selection.playlists && !restoredViaCollections && isJson && backupData?.playlists && Array.isArray(backupData.playlists)) {
    report({ message: getString("import_restoring_playlists") });
    const pj = await getSetting("user_playlists"); const existing: LocalPlaylist[] = pj ? JSON.parse(pj) : [];
    const crossRefs = backupData.playlistVideos || []; const vids = backupData.videos || [];
    const parsed: LocalPlaylist[] = backupData.playlists.map((pl: any) => {
      const refs = crossRefs.filter((r: any) => r.playlistId === pl.id).sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
      const tracks: VideoSummary[] = refs.map((ref: any) => ({ ref, vid: vids.find((v: any) => v.id === ref.videoId) })).filter(({ vid }: any) => vid).map(({ ref, vid }: any) => ({ id: vid.id, title: vid.title, channelName: vid.channelName || getString('download_size_unknown'), thumbnailUrl: vid.thumbnailUrl || `https://i.ytimg.com/vi/${vid.id}/hqdefault.jpg`, durationSeconds: typeof vid.duration === "number" ? vid.duration : 0, publishedText: vid.uploadDate || "Uploaded recently", viewCountText: vid.viewCount ? `${vid.viewCount} views` : "Track", addedAtInPlaylist: ref.addedAt > 0 ? ref.addedAt : null }));
      return { id: pl.id || `imported-${Date.now()}-${Math.random()}`, name: pl.name || "Imported Playlist", description: pl.description || "Imported from backup", tracks };
    });
    const merged = [...existing];
    for (const np of parsed) { const ei = merged.findIndex(p => p.id === np.id || p.name === np.name); if (ei !== -1) { const ep = merged[ei]; if (ep) { const ids = new Set(ep.tracks.map(t => t.id)); ep.tracks = [...ep.tracks, ...np.tracks.filter(t => !ids.has(t.id))]; } } else { merged.push(np); } counts.playlists++; }
    await setSetting("user_playlists", JSON.stringify(merged));
  }

  if (selection.history && !restoredViaCollections) {
    let ph: WatchHistoryRecord[] = [];
    if (isJson && backupData) { if (backupData.isFreeTubeHistory) ph = parseFreeTubeWatchHistory(backupData.rawText); else if (backupData.viewHistory && Array.isArray(backupData.viewHistory)) ph = backupData.viewHistory.map((item: any) => ({ videoId: item.videoId, title: item.title || "Watched Video", channelName: item.channelName || getString('download_size_unknown'), watchDate: typeof item.timestamp === "number" ? new Date(item.timestamp).toISOString() : new Date().toISOString(), watchDurationSeconds: item.position ? Math.round(item.position / 1000) : 0, totalDurationSeconds: item.duration ? Math.round(item.duration / 1000) : 0 })); else ph = parseJsonWatchHistory(backupData); }
    else if (isHtml) ph = parseHtmlWatchHistory(text);
    if (ph.length > 0) {
      report({ message: getString("import_importing_history", ph.length) });
      const valid = ph.filter(Boolean) as WatchHistoryRecord[];

      const CHUNK = 500;
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        await addWatchRecordsBulk(chunk);
        counts.history += chunk.length;
        report({ percent: 75 + Math.round((counts.history / valid.length) * 20) });
      }

      await bootstrapFromHistory(valid.map((record) => ({
        videoId: record.videoId,
        title: record.title,
        channelName: record.channelName ?? "",
        channelId: record.channelId ?? null,
        durationSeconds: record.totalDurationSeconds ?? null,
        watchedAt: Date.parse(record.watchDate) || 0,
        isMusic: Boolean(record.isMusic),
      })));
      void useHistoryStore.getState().load(true);
    }
  }

  // Defense against the Deep Flow restore trap: an imported active flag without its
  // (internal, never-exported) activation timestamp would otherwise mute watch-history
  // recording and FlowNeuro learning indefinitely.
  await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVE, "false");
  await setSettingValue(SETTINGS.DEEP_FLOW_ACTIVATED_AT, "0");

  if (counts.subscriptions + counts.playlists + counts.history + counts.settings === 0 && !restoredViaCollections && !(selection.neuro && brainToImport)) {
    throw new Error(getString("import_file_not_recognized"));
  }

  report({ percent: 100 });
  return { type: "done", counts };
}
