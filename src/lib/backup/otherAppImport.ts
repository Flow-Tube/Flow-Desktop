import { importOtherApp, type ImportFailure, type ImportKind, type ImportOutcome, type ImportReport } from "../api/backup";
import { getPlural, getString, type StringKey } from "../i18n/index";
import { refreshAfterRestore } from "./refreshAfterRestore";

const FAILURES: Record<ImportFailure, StringKey> = {
  invalid_format: "import_error_invalid_format",
  too_large: "import_error_too_large",
  no_content: "import_error_no_content",
  no_entries: "import_error_no_entries",
  no_videos: "import_error_no_videos",
  no_likes: "import_error_no_likes",
  failed: "import_error_failed",
};

export function importFailureMessage(reason: ImportFailure): string {
  return getString(FAILURES[reason]);
}

/** What an import added, the way Android's Takeout result says it. */
export function importReportSummary(report: ImportReport): string {
  const parts: string[] = [];
  if (report.subscriptions > 0) parts.push(getPlural("import_part_subscriptions", report.subscriptions));
  if (report.history > 0) parts.push(getPlural("import_part_history", report.history));
  if (report.playlists > 0) {
    parts.push(`${getPlural("import_part_playlists", report.playlists)} (${getPlural("import_part_videos", report.playlistVideos)})`);
  }
  if (report.musicPlaylists > 0) parts.push(getPlural("import_part_music_playlists", report.musicPlaylists));
  if (report.musicLibrary > 0) parts.push(getPlural("import_part_library", report.musicLibrary));
  if (report.likes > 0) parts.push(getPlural("import_part_likes", report.likes));
  return parts.length > 0 ? parts.join(", ") : getString("import_done_nothing_new");
}

/** Runs the import and brings the app's stores up to date with what it wrote. */
export async function runOtherAppImport(kind: ImportKind, paths: string[]): Promise<ImportOutcome> {
  const outcome = await importOtherApp(kind, paths, getString("import_music_library_name"));
  if (outcome.type === "done") await refreshAfterRestore();
  return outcome;
}
