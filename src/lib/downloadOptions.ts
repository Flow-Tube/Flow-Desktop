import type { DownloadableFormat } from "./api/downloads";
import { SETTINGS } from "./settings/schema";

export type CodecChoice = "Auto" | "H.264" | "VP9" | "AV1";
export const CODEC_CHOICES: CodecChoice[] = ["Auto", "H.264", "VP9", "AV1"];

/** The codec "Auto" stands for on this system: macOS cannot play VP9 inside MP4,
 *  so Auto keeps H.264 there; elsewhere VP9 gives smaller files at the same quality. */
export function autoCodec(isMac: boolean): Exclude<CodecChoice, "Auto"> {
  return isMac ? "H.264" : "VP9";
}

export function preferredCodec(values: Record<string, string>, isMac: boolean): Exclude<CodecChoice, "Auto"> {
  const chosen = values[SETTINGS.DOWNLOAD_VIDEO_CODEC] as CodecChoice | undefined;
  return chosen && chosen !== "Auto" && CODEC_CHOICES.includes(chosen) ? chosen : autoCodec(isMac);
}

/** One row per resolution: the chosen codec's best frame rate, or under "Auto" the
 *  preferred codec first and any other codec when it is missing at that height. */
export function qualityRows(
  formats: DownloadableFormat[],
  choice: CodecChoice,
  preferred: Exclude<CodecChoice, "Auto">,
): DownloadableFormat[] {
  const order = choice === "Auto" ? [preferred, "H.264", "VP9", "AV1", "HEVC", "VP8"] : [choice];
  const byHeight = new Map<number, DownloadableFormat>();
  for (const format of formats) {
    const rank = order.indexOf(format.videoCodec);
    if (rank < 0) continue;
    const height = format.height ?? 0;
    const current = byHeight.get(height);
    if (!current) {
      byHeight.set(height, format);
      continue;
    }
    const currentRank = order.indexOf(current.videoCodec);
    const better =
      rank < currentRank || (rank === currentRank && (format.fps ?? 0) > (current.fps ?? 0));
    if (better) byHeight.set(height, format);
  }
  return [...byHeight.values()].sort((left, right) => (right.height ?? 0) - (left.height ?? 0));
}

/** The tallest row at or below the preferred height, else the smallest one. */
export function defaultRow(rows: DownloadableFormat[], preferredHeight: number): DownloadableFormat | null {
  return rows.find((row) => (row.height ?? 0) <= preferredHeight) ?? rows[rows.length - 1] ?? null;
}

export function resolutionBadge(height: number | null): string | null {
  if (!height) return null;
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  if (height >= 1080) return "HD";
  return null;
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 100 * 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** A constant-bitrate audio estimate: kbps × seconds. */
export function audioSizeEstimate(durationSeconds: number | null | undefined, kbps: number): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  return Math.round((durationSeconds * kbps * 1000) / 8);
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The download speed and time left shown on a progress card. */
export function formatSpeed(bytesPerSecond: number | null | undefined): string | null {
  const size = formatBytes(bytesPerSecond);
  return size ? `${size}/s` : null;
}

export function formatTimeLeft(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds < 0) return null;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}
