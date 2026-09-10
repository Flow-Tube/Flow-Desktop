import { useEffect, useState, type RefObject } from "react";

import { getString } from "../../lib/i18n/index";
import { usePlayerStore } from "../../store/usePlayerStore";
import { formatTime } from "../../lib/musicFormat";

const SAMPLE_INTERVAL_MS = 1000;

interface MediaSample {
  width: number;
  height: number;
  droppedFrames: number | null;
  totalFrames: number | null;
  bufferedAheadSeconds: number | null;
  readyState: number;
}

interface StatsForNerdsProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  duration: number;
  playbackRate: number;
  qualityLabel?: string | null;
  mimeType?: string | null;
  bitrate?: number | null;
  captionCount?: number;
  compact?: boolean;
  className?: string;
}

function readSample(video: HTMLVideoElement): MediaSample {
  const quality = video.getVideoPlaybackQuality?.();
  const buffered = video.buffered;
  const bufferedEnd = buffered.length > 0 ? buffered.end(buffered.length - 1) : null;
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    droppedFrames: quality ? quality.droppedVideoFrames : null,
    totalFrames: quality ? quality.totalVideoFrames : null,
    bufferedAheadSeconds:
      bufferedEnd === null ? null : Math.max(0, Math.round(bufferedEnd - video.currentTime)),
    readyState: video.readyState,
  };
}

function codecName(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  const codecs = /codecs="?([^";]+)"?/i.exec(mimeType);
  return codecs?.[1] ?? mimeType.split(";")[0] ?? null;
}

/**
 * Playback telemetry shared by the video player and the Shorts surface. Frame
 * counters and buffer level only move between renders, so this samples the
 * media element on its own clock rather than riding the parent's re-renders.
 */
export function StatsForNerds({
  videoRef,
  currentTime,
  duration,
  playbackRate,
  qualityLabel,
  mimeType,
  bitrate,
  captionCount,
  compact = false,
  className = "",
}: StatsForNerdsProps) {
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const [sample, setSample] = useState<MediaSample | null>(null);

  useEffect(() => {
    const read = () => {
      const video = videoRef.current;
      if (video) setSample(readSample(video));
    };
    read();
    const timer = setInterval(read, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [videoRef]);

  const rows: Array<[string, string]> = [
    [getString("stats_time"), `${formatTime(currentTime)} / ${formatTime(duration)}`],
    [
      getString("stats_resolution"),
      sample && sample.width > 0 ? `${sample.width}x${sample.height}` : "-",
    ],
  ];

  if (qualityLabel) rows.push([getString("stats_quality"), qualityLabel]);

  rows.push([
    getString("stats_frames"),
    sample && sample.totalFrames !== null
      ? `${sample.droppedFrames} ${getString("stats_frames_dropped_of")} ${sample.totalFrames}`
      : "-",
  ]);
  rows.push([
    getString("stats_buffer_health"),
    sample?.bufferedAheadSeconds === null || sample === null ? "-" : `${sample.bufferedAheadSeconds}s`,
  ]);

  if (bitrate) rows.push([getString("stats_bitrate"), `${Math.round(bitrate / 1000)} kbps`]);
  const codec = codecName(mimeType);
  if (codec) rows.push([getString("stats_codec"), codec]);

  rows.push([getString("stats_speed"), `${playbackRate}x`]);
  rows.push([
    getString("stats_volume"),
    muted ? getString("stats_volume_muted") : `${Math.round(volume * 100)}%`,
  ]);
  rows.push([getString("stats_ready_state"), String(sample?.readyState ?? "-")]);

  if (captionCount !== undefined) {
    rows.push([getString("stats_captions"), String(captionCount)]);
  }

  return (
    <div
      className={`pointer-events-none absolute z-40 rounded-xl border border-chrome-white/10 bg-chrome-black/70 p-3 text-xs font-semibold text-chrome-zinc-100 shadow-2xl backdrop-blur-md animate-fade-in ${
        compact ? "w-[min(82vw,300px)]" : "w-[min(92vw,320px)]"
      } ${className}`}
    >
      <div className="mb-2 text-sm font-black">{getString("stats_title")}</div>
      <div
        className={`grid gap-x-3 gap-y-1 text-chrome-zinc-300 ${
          compact ? "grid-cols-[96px_1fr]" : "grid-cols-[110px_1fr]"
        }`}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <span className="text-chrome-zinc-500">{label}</span>
            <span className="truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
