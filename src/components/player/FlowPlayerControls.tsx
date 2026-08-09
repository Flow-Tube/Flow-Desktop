import React, { useState, useEffect, useRef } from "react";
import {
  AudioLines,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  Gauge,
  ListVideo,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  Settings as SettingsIcon,
  SkipBack,
  SkipForward,
  Shrink,
  Volume1,
  Volume2,
  VolumeX,
  Sliders,
} from "lucide-react";
import { usePlayerStore, type PlaybackRate } from "../../store/usePlayerStore";
import { useSettingsStore, type SponsorBlockCategory } from "../../store/useSettingsStore";
import type { AudioTrack, CaptionTrack, StreamVariant, VideoChapter } from "../../types/video";
import { SubtitleCustomizer } from "./SubtitleCustomizer";
import { SponsorBlockSubmitDialog } from "./SponsorBlockSubmitDialog";
import { SponsorBlockIcon } from "../ui/SponsorBlockIcon";
import { getString } from "../../lib/i18n/index";
import { videoCodecLabel } from "../../lib/settings/playerRuntime";

export interface FlowPlayerControlsProps {
  title?: string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;

  containerRef: React.RefObject<HTMLDivElement | null>;

  controlsVisible: boolean;
  setControlsVisible: (visible: boolean) => void;
  shouldShowControls: boolean;

  qualities?: StreamVariant[];
  selectedQualityId?: string | null;
  isDashPlayback?: boolean;
  isLive?: boolean;
  onSelectQuality?: (variant: StreamVariant | "auto") => void;

  captions?: CaptionTrack[];
  selectedCaptionId: string;
  setSelectedCaptionId: (id: string) => void;

  audioTracks?: AudioTrack[];
  selectedAudioTrackId?: string | null;
  setSelectedAudioTrackId: (id: string | null) => void;

  bufferedPct: number;

  sleepMinutes: number;
  setSleepMinutes: React.Dispatch<React.SetStateAction<number>>;

  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;

  isFullscreen: boolean;
  toggleFullscreen: () => void;

  isPip: boolean;
  togglePictureInPicture: () => void;
  showPipButton?: boolean;
  showFullscreenTitle?: boolean;

  seekTo: (time: number) => void;
  togglePlay: () => void;
  speedOptions?: PlaybackRate[];
  speedSliderEnabled?: boolean;
  onSelectPlaybackRate?: (playbackRate: PlaybackRate) => void;

  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isScrubbing: boolean;
  setIsScrubbing: React.Dispatch<React.SetStateAction<boolean>>;

  chapters?: VideoChapter[];
  activeQualityLabel?: string;
}

type SettingsPane = "root" | "speed" | "quality" | "captions" | "captions-customize" | "audio" | "sleep";

const defaultSpeedOptions: PlaybackRate[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const sleepOptions = [
  { label: "Off", minutes: 0 },
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
  { label: "1 hour", minutes: 60 },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// The seekable DVR window of a live stream: [start, end] in player-timeline seconds.
function liveWindow(video: HTMLVideoElement) {
  const len = video.seekable.length;
  if (!len) return { start: 0, end: 0 };
  return { start: video.seekable.start(0), end: video.seekable.end(len - 1) };
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export const FlowPlayerControls: React.FC<FlowPlayerControlsProps> = ({
  title,
  containerRef,
  shouldShowControls,
  qualities = [],
  selectedQualityId,
  isDashPlayback = false,
  isLive = false,
  onSelectQuality,
  captions = [],
  selectedCaptionId,
  setSelectedCaptionId,
  audioTracks = [],
  selectedAudioTrackId,
  setSelectedAudioTrackId,
  bufferedPct,
  sleepMinutes,
  setSleepMinutes,
  muted,
  setMuted,
  isFullscreen,
  toggleFullscreen,
  isPip,
  togglePictureInPicture,
  showPipButton = true,
  showFullscreenTitle = false,
  seekTo,
  togglePlay,
  speedOptions = defaultSpeedOptions,
  speedSliderEnabled = false,
  onSelectPlaybackRate,
  settingsOpen,
  setSettingsOpen,
  isScrubbing,
  setIsScrubbing,
  chapters = [],
  activeQualityLabel,
}) => {
  const {
    isPlaying,
    currentVideo,
    volume,
    setVolume,
    playbackRate,
    setPlaybackRate,
    duration,
    playNext,
    playPrevious,
    isTheaterMode,
    setIsTheaterMode,
    sponsorBlockSegments,
    isChaptersPanelOpen,
    setIsChaptersPanelOpen,
    isQueuePanelOpen,
    setIsQueuePanelOpen,
  } = usePlayerStore();

  const { sponsorBlockColors, sponsorBlockEnabled, sbSubmitEnabled } = useSettingsStore();
  const selectPlaybackRate = onSelectPlaybackRate ?? setPlaybackRate;

  const [settingsPane, setSettingsPane] = useState<SettingsPane>("root");
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitAtSeconds, setSubmitAtSeconds] = useState(0);
  const chapterPillRef = useRef<HTMLButtonElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeTextRef = useRef<HTMLDivElement>(null);
  const hoverPillRef = useRef<HTMLDivElement>(null);
  const hoverTextRef = useRef<HTMLSpanElement>(null);

  const segments = React.useMemo(() => {
    if (isLive || !chapters || chapters.length === 0) {
      return [{ title: "", startSeconds: 0, endSeconds: duration || 1 }];
    }
    const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
    const firstChapter = sorted[0];
    if (firstChapter && firstChapter.startSeconds > 0) {
      sorted.unshift({
        title: "Intro",
        startSeconds: 0,
        endSeconds: firstChapter.startSeconds,
      });
    }
    const capped = sorted.map((chapter, idx) => {
      const nextStart = sorted[idx + 1]?.startSeconds ?? duration;
      return {
        ...chapter,
        endSeconds: Math.max(chapter.endSeconds || nextStart, nextStart),
      };
    });
    return capped;
  }, [chapters, duration, isLive]);

  useEffect(() => {
    let animId: number;
    const updateProgress = () => {
      const video = containerRef.current?.querySelector("video");
      if (video) {
        const cur = video.currentTime;

        // Live: the seekbar tracks the DVR window and the time shows real broadcast elapsed.
        if (isLive) {
          const { start, end } = liveWindow(video);
          const win = Math.max(1, end - start);
          const livePct = Math.min(100, Math.max(0, ((cur - start) / win) * 100));
          if (progressBarRef.current) progressBarRef.current.style.width = `${livePct}%`;
          containerRef.current
            ?.querySelectorAll(".chapter-progress-fill, .chapter-buffered-fill")
            .forEach((fill) => ((fill as HTMLElement).style.width = `${livePct}%`));
          if (playheadRef.current) playheadRef.current.style.left = `${livePct}%`;
          if (chapterPillRef.current) chapterPillRef.current.style.display = "none";
          if (timeTextRef.current) {
            const offset = parseFloat(video.dataset.liveOffset || "0");
            timeTextRef.current.textContent = formatTime(cur + offset);
          }
          animId = requestAnimationFrame(updateProgress);
          return;
        }

        const dur = video.duration || duration || 0;
        const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

        if (progressBarRef.current) {
          progressBarRef.current.style.width = `${pct}%`;
        }

        // Update split segments progress fills
        const progressFills = containerRef.current?.querySelectorAll(".chapter-progress-fill");
        progressFills?.forEach((fill) => {
          const start = parseFloat(fill.getAttribute("data-start") || "0");
          const end = parseFloat(fill.getAttribute("data-end") || "0");
          let segmentPct = 0;
          if (cur > end) segmentPct = 100;
          else if (cur < start) segmentPct = 0;
          else if (end > start) segmentPct = ((cur - start) / (end - start)) * 100;
          (fill as HTMLElement).style.width = `${segmentPct}%`;
        });

        // Update split segments buffered fills
        const bufferedFills = containerRef.current?.querySelectorAll(".chapter-buffered-fill");
        const bufferedTime = (bufferedPct / 100) * dur;
        bufferedFills?.forEach((fill) => {
          const start = parseFloat(fill.getAttribute("data-start") || "0");
          const end = parseFloat(fill.getAttribute("data-end") || "0");
          let segmentPct = 0;
          if (bufferedTime > end) segmentPct = 100;
          else if (bufferedTime < start) segmentPct = 0;
          else if (end > start) segmentPct = ((bufferedTime - start) / (end - start)) * 100;
          (fill as HTMLElement).style.width = `${segmentPct}%`;
        });

        if (playheadRef.current) {
          playheadRef.current.style.left = `${pct}%`;
        }

        const activeChapter = segments?.find(
          (c) => cur >= c.startSeconds && cur <= c.endSeconds
        );

        if (timeTextRef.current) {
          timeTextRef.current.innerHTML = `${formatTime(cur)} <span class="text-chrome-zinc-400">/</span> ${formatTime(dur)}`;
        }

        if (chapterPillRef.current) {
          if (activeChapter && activeChapter.title) {
            chapterPillRef.current.style.display = "flex";
            const titleEl = chapterPillRef.current.querySelector(".chapter-title");
            if (titleEl) {
              titleEl.textContent = activeChapter.title;
            }
          } else {
            chapterPillRef.current.style.display = "none";
          }
        }
      }
      animId = requestAnimationFrame(updateProgress);
    };

    animId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animId);
  }, [containerRef, duration, segments, bufferedPct, isLive]);

  const progressPct =
    duration > 0
      ? Math.min(100, Math.max(0, (usePlayerStore.getState().currentTime / duration) * 100))
      : 0;

  const supportedQualities = qualities;

  const selectedCaption =
    captions.find((caption) => caption.id === selectedCaptionId) || null;
  const selectedAudioTrack =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ||
    audioTracks.find((track) => track.isDefault) ||
    audioTracks[0] ||
    null;

  useEffect(() => {
    if (!settingsOpen) {
      setSettingsPane("root");
    }
  }, [settingsOpen]);

  const updateHoverPreview = (clientX: number, trackEl?: HTMLElement) => {
    const pill = hoverPillRef.current;
    if (!pill || isLive || !(duration > 0)) return;
    const track =
      trackEl ?? containerRef.current?.querySelector<HTMLElement>("[data-progress-track]");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    // Clamp so the pill keeps tracking at the track edges during a drag.
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    pill.style.left = `${x}px`;
    pill.style.opacity = "1";
    if (hoverTextRef.current) {
      const time = (x / rect.width) * duration;
      const chapter = segments?.find((c) => time >= c.startSeconds && time <= c.endSeconds);
      hoverTextRef.current.textContent = chapter?.title
        ? `${formatTime(time)} • ${chapter.title}`
        : formatTime(time);
    }
  };

  const hideHoverPreview = () => {
    if (hoverPillRef.current) hoverPillRef.current.style.opacity = "0";
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const track = containerRef.current?.querySelector(
        "[data-progress-track]"
      );
      if (!(track instanceof HTMLElement)) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (e.clientX - rect.left) / rect.width)
      );
      updateHoverPreview(e.clientX, track);
      if (isLive) {
        const video = containerRef.current?.querySelector("video");
        if (!video || !video.seekable.length) return;
        const { start, end } = liveWindow(video);
        seekTo(start + ratio * Math.max(0, end - start));
        return;
      }
      if (duration <= 0) return;
      seekTo(ratio * duration);
    };

    const handlePointerUp = () => {
      hideHoverPreview();
      setIsScrubbing(false);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isScrubbing, duration, seekTo, setIsScrubbing, containerRef, isLive]);

  const handlePointerSeek = (clientX: number) => {
    const track = containerRef.current?.querySelector("[data-progress-track]");
    if (!(track instanceof HTMLElement)) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (isLive) {
      const video = containerRef.current?.querySelector("video");
      if (!video || !video.seekable.length) return;
      const { start, end } = liveWindow(video);
      seekTo(start + ratio * Math.max(0, end - start));
      return;
    }
    if (duration <= 0) return;
    seekTo(ratio * duration);
  };

  const seekToLiveEdge = () => {
    const video = containerRef.current?.querySelector("video");
    if (video && video.seekable.length) {
      seekTo(video.seekable.end(video.seekable.length - 1));
    }
  };

  const handleProgressMove = (event: React.MouseEvent<HTMLDivElement>) => {
    updateHoverPreview(event.clientX, event.currentTarget);
  };

  const renderSettingRow = (
    label: string,
    value: React.ReactNode,
    icon: React.ReactNode,
    onClick: () => void
  ) => (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-chrome-zinc-100 transition-colors hover:bg-chrome-white/10"
    >
      <span className="grid h-7 w-7 place-items-center text-chrome-zinc-300">
        {icon}
      </span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="max-w-[46%] truncate text-right text-chrome-zinc-300">
        {value}
      </span>
      <ChevronRight size={16} className="text-chrome-zinc-400" />
    </button>
  );

  return (
    <>
      <div
        className={cx(
          "pointer-events-none absolute inset-0 z-20 flex h-full w-full flex-col justify-end bg-gradient-to-t from-chrome-black/85 via-chrome-black/40 to-transparent pt-24 transition-opacity duration-200",
          isTheaterMode ? "px-4 pb-3 sm:px-6 sm:pb-4 lg:px-8" : "px-3 pb-3 sm:px-5 sm:pb-4",
          shouldShowControls ? "opacity-100" : "opacity-0"
        )}
      >
        <div
          className="pointer-events-auto"
          onClick={(event) => event.stopPropagation()}
        >
          {title && (!isFullscreen || showFullscreenTitle) && (
            <div className="mb-2 hidden max-w-[70%] truncate text-sm font-bold text-chrome-white/95 sm:block">
              {title}
            </div>
          )}

          <div
            data-progress-track
            className="group/seekbar relative flex h-6 cursor-pointer items-center"
            onMouseMove={handleProgressMove}
            onMouseLeave={() => {
              // During a drag the document-level pointermove owns the pill.
              if (!isScrubbing) hideHoverPreview();
            }}
            onMouseDown={(event) => {
              setIsScrubbing(true);
              handlePointerSeek(event.clientX);
            }}
            onMouseUp={() => setIsScrubbing(false)}
            onClick={(event) => handlePointerSeek(event.clientX)}
          >
            {/* Split Chapter Seekbar Track — the whole track springs taller on hover/scrub, mirroring the mobile seekbar. */}
            <div className="relative flex h-full w-full select-none items-center gap-[3px] pointer-events-none">
              {segments.map((segment, idx) => {
                const segmentDuration = segment.endSeconds - segment.startSeconds;
                return (
                  <div
                    key={`seekbar-segment-${idx}`}
                    className="group/seg pointer-events-auto relative flex h-full flex-1 items-center"
                    style={{
                      flexGrow: Math.max(0.1, segmentDuration),
                    }}
                  >
                    <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-chrome-white/25 transition-[height] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/seg:h-[10px]">
                      {/* Buffered Fill for this Segment */}
                      <div
                        className="chapter-buffered-fill absolute inset-y-0 left-0 rounded-full bg-chrome-white/40 pointer-events-none transition-[width] duration-150"
                        data-start={segment.startSeconds}
                        data-end={segment.endSeconds}
                        style={{ width: "0%" }}
                      />

                      {/* Playback Progress Fill for this Segment */}
                      <div
                        className="chapter-progress-fill absolute inset-y-0 left-0 rounded-full bg-primary pointer-events-none"
                        data-start={segment.startSeconds}
                        data-end={segment.endSeconds}
                        style={{ width: "0%" }}
                      />

                      {/* SponsorBlock segments drawn above the progress fill so they stay visible after playback passes them. */}
                      {sponsorBlockEnabled && sponsorBlockSegments.map((sbSeg) => {
                        const sStart = sbSeg.segment[0];
                        const sEnd = sbSeg.segment[1];
                        const overlapStart = Math.max(segment.startSeconds, sStart);
                        const overlapEnd = Math.min(segment.endSeconds, sEnd);
                        if (overlapStart < overlapEnd) {
                          const leftPct = ((overlapStart - segment.startSeconds) / (segment.endSeconds - segment.startSeconds)) * 100;
                          const widthPct = ((overlapEnd - overlapStart) / (segment.endSeconds - segment.startSeconds)) * 100;
                          const segmentColor = sponsorBlockColors[sbSeg.category as SponsorBlockCategory] || "var(--color-chrome-red-500)";
                          return (
                            <div
                              key={sbSeg.UUID}
                              className="absolute inset-y-0 pointer-events-none opacity-80"
                              style={{
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                backgroundColor: segmentColor
                              }}
                            />
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Invisible native progress tracking width marker */}
            <div
              ref={progressBarRef}
              className="absolute pointer-events-none opacity-0"
              style={{ width: `${progressPct}%` }}
            />

            {/* Playhead thumb — hidden until hover/scrub, then springs in: white knob + primary ring + soft state layer, like the mobile thumb. */}
            <div
              ref={playheadRef}
              className={cx(
                "absolute top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 pointer-events-none",
                "transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                isScrubbing ? "scale-100" : "scale-0 group-hover/seekbar:scale-100"
              )}
              style={{ left: `${progressPct}%` }}
            >
              <div className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20" />
              <div className="relative h-3.5 w-3.5 rounded-full border-[3px] border-primary bg-chrome-white shadow-md shadow-chrome-black/40" />
            </div>

            {/* Hover preview pill — always mounted so the imperative position
                writes land before it fades in; only opacity animates. */}
            {!isLive && (
              <div
                ref={hoverPillRef}
                className="absolute bottom-8 -translate-x-1/2 flex flex-col items-center pointer-events-none z-50 opacity-0 transition-opacity duration-75"
                style={{ left: 0 }}
              >
                <div className="bg-chrome-black/80 border border-chrome-white/10 px-2 py-1 rounded-full text-chrome-white min-w-max text-center flex flex-col gap-0.5 leading-tight">
                  <span ref={hoverTextRef} className="text-[12px] font-medium font-sans" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <button
                type="button"
                title="Previous"
                onClick={playPrevious}
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10"
              >
                <SkipBack size={19} fill="currentColor" />
              </button>
              <button
                type="button"
                title={isPlaying ? "Pause" : "Play"}
                onClick={togglePlay}
                className="grid h-10 w-10 place-items-center rounded-full bg-chrome-black/20 text-chrome-white hover:bg-chrome-white/10 transition-transform active:scale-95"
              >
                {isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                title="Next"
                onClick={() => playNext()}
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10"
              >
                <SkipForward size={19} fill="currentColor" />
              </button>

              <div className="group/volume hidden items-center sm:flex bg-chrome-black/20 rounded-full hover:pr-2">
                <button
                  type="button"
                  title="Mute"
                  onClick={() => setMuted((value) => !value)}
                  className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10"
                >
                  {muted || volume === 0 ? (
                    <VolumeX size={19} />
                  ) : volume < 0.55 ? (
                    <Volume1 size={19} />
                  ) : (
                    <Volume2 size={19} />
                  )}
                </button>
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    setMuted(value === 0);
                  }}
                  className="h-1 w-0 accent-chrome-white opacity-0 transition-all group-hover/volume:w-20 group-hover/volume:opacity-100"
                />
              </div>

              <div className="ml-1 flex items-center gap-1.5">
                <div
                  ref={timeTextRef}
                  className="whitespace-nowrap text-xs font-semibold text-chrome-white sm:text-sm bg-chrome-black/20 rounded-full px-2 py-1"
                />
                {isLive && (
                  <button
                    type="button"
                    title="Go to live"
                    onClick={seekToLiveEdge}
                    className="flex items-center gap-1 whitespace-nowrap rounded-full bg-chrome-black/20 px-2 py-1 text-xs font-bold uppercase tracking-wide text-chrome-white hover:bg-chrome-white/10"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-chrome-red-500 animate-pulse" />
                    Live
                  </button>
                )}
              </div>

              <button
                ref={chapterPillRef}
                type="button"
                onClick={() => setIsChaptersPanelOpen(!isChaptersPanelOpen)}
                className="hidden items-center gap-1.5 text-xs font-medium text-chrome-white sm:text-sm bg-chrome-black/20 hover:bg-chrome-white/10 rounded-full px-2 py-1 transition-all select-none cursor-pointer active:scale-95 group/pill max-w-[150px] sm:max-w-[260px] truncate"
              >
                <span className="chapter-title truncate"></span>
                <ChevronRight size={14} className="text-chrome-zinc-400 group-hover/pill:text-chrome-white transition-colors shrink-0" />
              </button>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 bg-chrome-black/20 rounded-full px-1 py-1">
              <button
                type="button"
                title={getString("queue_title")}
                aria-label={getString("queue_title")}
                onClick={() => setIsQueuePanelOpen(!isQueuePanelOpen)}
                className={cx(
                  "grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10",
                  isQueuePanelOpen && "bg-chrome-white/15 text-primary/90"
                )}
              >
                <ListVideo size={19} />
              </button>
              {sbSubmitEnabled && currentVideo && (
                <button
                  type="button"
                  title="Submit SponsorBlock segment"
                  aria-label="Submit SponsorBlock segment"
                  onClick={() => {
                    setSubmitAtSeconds(usePlayerStore.getState().currentTime);
                    setSubmitDialogOpen(true);
                  }}
                  className="hidden h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10 sm:grid"
                >
                  <SponsorBlockIcon className="h-[18px] w-[18px]" />
                </button>
              )}
              <button
                type="button"
                title="Quality"
                onClick={() => {
                  if (settingsOpen && settingsPane === "quality") {
                    setSettingsOpen(false);
                    setSettingsPane("root");
                  } else {
                    setSettingsOpen(true);
                    setSettingsPane("quality");
                  }
                }}
                className="hidden h-7 items-center rounded-full px-2 text-xs font-bold text-chrome-white hover:bg-chrome-white/10 sm:flex"
              >
                {selectedQualityId === "auto"
                  ? `Auto${activeQualityLabel ? ` (${activeQualityLabel})` : ""}`
                  : (supportedQualities.find(q => q.id === selectedQualityId)?.qualityLabel || "Auto")}
              </button>
              <button
                type="button"
                title="Captions"
                onClick={() => {
                  if (settingsOpen && settingsPane === "captions") {
                    setSettingsOpen(false);
                    setSettingsPane("root");
                  } else {
                    setSettingsOpen(true);
                    setSettingsPane("captions");
                  }
                }}
                className={cx(
                  "grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10",
                  selectedCaptionId !== "off" && "text-primary/90"
                )}
              >
                <Captions size={19} />
              </button>
              <button
                type="button"
                title="Settings"
                onClick={() => {
                  setSettingsOpen((value) => !value);
                  setSettingsPane("root");
                }}
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10"
              >
                <SettingsIcon
                  size={19}
                  className={
                    settingsOpen
                      ? "rotate-90 transition-transform text-primary/90"
                      : "transition-transform"
                  }
                />
              </button>
              {showPipButton && (
                <button
                  type="button"
                  title="Picture in picture"
                  onClick={togglePictureInPicture}
                  className={cx(
                    "hidden h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10 sm:grid",
                    isPip && "bg-chrome-white/15"
                  )}
                >
                  <PictureInPicture2 size={19} />
                </button>
              )}
              <button
                type="button"
                title="Theater mode"
                onClick={() => setIsTheaterMode(!isTheaterMode)}
                className={cx(
                  "grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10",
                  isTheaterMode && "bg-chrome-white/15"
                )}
              >
                {isTheaterMode ? <Shrink size={19} /> : <Expand size={19} />}
              </button>
              <button
                type="button"
                title="Fullscreen"
                onClick={toggleFullscreen}
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10"
              >
                {isFullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cx(
          "absolute bottom-20 right-3 z-40 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover/65 p-2 text-chrome-white shadow-2xl backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] transform sm:right-5",
          settingsOpen
            ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
            : "opacity-0 translate-y-4 scale-95 pointer-events-none"
        )}
      >
        {settingsPane !== "root" && (
          <div className="mb-1 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => {
                if (settingsPane === "captions-customize") {
                  setSettingsPane("captions");
                } else {
                  setSettingsPane("root");
                }
              }}
              className="flex h-10 items-center gap-2 rounded-md px-1 text-sm font-bold hover:bg-chrome-white/10 text-left"
            >
              <ChevronLeft size={18} />
              {settingsPane === "speed"
                ? "Playback speed"
                : settingsPane === "quality"
                ? "Quality"
                : settingsPane === "captions"
                ? "Subtitles/CC"
                : settingsPane === "captions-customize"
                ? "Subtitle Style"
                : settingsPane === "audio"
                ? "Audio track"
                : "Sleep timer"}
            </button>
            {settingsPane === "captions" && (
              <button
                type="button"
                title="Customize Subtitles"
                onClick={() => setSettingsPane("captions-customize")}
                className="grid h-8 w-8 place-items-center rounded-md text-chrome-zinc-300 hover:bg-chrome-white/10 hover:text-chrome-white"
              >
                <Sliders size={17} />
              </button>
            )}
          </div>
        )}

        {settingsPane === "root" && (
          <div className="space-y-1 animate-pane-in">
            {renderSettingRow(
              "Playback speed",
              playbackRate === 1 ? "Normal" : `${playbackRate}x`,
              <Gauge size={18} />,
              () => setSettingsPane("speed")
            )}
            {renderSettingRow(
              "Quality",
              selectedQualityId === "auto"
                ? `Auto${activeQualityLabel ? ` (${activeQualityLabel})` : ""}`
                : (supportedQualities.find(q => q.id === selectedQualityId)?.qualityLabel || "Auto"),
              <Monitor size={18} />,
              () => setSettingsPane("quality")
            )}
            {renderSettingRow(
              "Subtitles/CC",
              selectedCaption ? selectedCaption.label : "Off",
              <Captions size={18} />,
              () => setSettingsPane("captions")
            )}
            {renderSettingRow(
              "Subtitle Style",
              "Customize",
              <Sliders size={18} />,
              () => setSettingsPane("captions-customize")
            )}
            {renderSettingRow(
              "Audio track",
              selectedAudioTrack?.label || "Original",
              <AudioLines size={18} />,
              () => setSettingsPane("audio")
            )}
            {renderSettingRow(
              "Sleep timer",
              sleepMinutes ? `${sleepMinutes} min` : "Off",
              <Pause size={18} />,
              () => setSettingsPane("sleep")
            )}
          </div>
        )}

        {settingsPane === "speed" && (
          <div className="space-y-1 animate-pane-in max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden">
            {speedSliderEnabled && (
              <div className="rounded-md px-3 py-3 text-sm text-chrome-zinc-100">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-chrome-zinc-300">
                  <span>Speed</span>
                  <span className="font-mono text-primary">{playbackRate}x</span>
                </div>
                <input
                  aria-label="Playback speed"
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={playbackRate}
                  onChange={(event) => selectPlaybackRate(Number(event.target.value))}
                  className="h-1 w-full accent-primary"
                />
              </div>
            )}
            {speedOptions.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => {
                  selectPlaybackRate(speed);
                  setSettingsPane("root");
                }}
                className="flex h-10 w-full items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-chrome-white/10"
              >
                <span>{speed === 1 ? "Normal" : `${speed}x`}</span>
                {playbackRate === speed && <Check size={17} />}
              </button>
            ))}
          </div>
        )}

        {settingsPane === "quality" && (
          <div className="space-y-1 animate-pane-in max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden">
            <button
              type="button"
              onClick={() => {
                onSelectQuality?.("auto");
                setSettingsPane("root");
                setSettingsOpen(false);
              }}
              className="flex h-10 w-full items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-chrome-white/10 text-chrome-zinc-100"
            >
              <span className="flex items-center gap-1.5">
                <span>Auto</span>
                {selectedQualityId === "auto" && activeQualityLabel && (
                  <span className="text-xs text-chrome-zinc-400 font-normal">
                    ({activeQualityLabel})
                  </span>
                )}
              </span>
              {selectedQualityId === "auto" && <Check size={17} />}
            </button>

            {supportedQualities.map((quality) => {
              const codec = videoCodecLabel(quality.mimeType);
              return (
                <button
                  key={quality.id}
                  type="button"
                  onClick={() => {
                    if (
                      !isDashPlayback &&
                      !quality.hasAudio &&
                      !audioTracks.some((track) => !!track.localUrl)
                    ) {
                      return;
                    }
                    onSelectQuality?.(quality);
                    setSettingsPane("root");
                    setSettingsOpen(false);
                  }}
                  className={cx(
                    "flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium text-chrome-zinc-100",
                    isDashPlayback ||
                      quality.hasAudio ||
                      audioTracks.some((track) => !!track.localUrl)
                      ? "hover:bg-chrome-white/10"
                      : "cursor-not-allowed text-chrome-zinc-500"
                  )}
                >
                  <span className="flex flex-col text-left leading-tight">
                    <span>{quality.qualityLabel}</span>
                    {codec && (
                      <span className="text-xs font-normal text-chrome-zinc-400">{codec}</span>
                    )}
                  </span>
                  {selectedQualityId === quality.id && <Check size={17} />}
                </button>
              );
            })}
          </div>
        )}

        {settingsPane === "captions" && (
          <div className="space-y-1 animate-pane-in max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden">
            <button
              type="button"
              onClick={() => {
                setSelectedCaptionId("off");
                setSettingsPane("root");
              }}
              className="flex h-10 w-full items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-chrome-white/10"
            >
              <span>Off</span>
              {selectedCaptionId === "off" && <Check size={17} />}
            </button>
            {captions.map((caption) => (
              <button
                key={caption.id}
                type="button"
                onClick={() => {
                  setSelectedCaptionId(caption.id);
                  setSettingsPane("root");
                }}
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-chrome-white/10"
              >
                <span className="text-left">
                  {caption.label}
                  {caption.isAutoGenerated && (
                    <span className="ml-1 text-xs text-chrome-zinc-400">auto</span>
                  )}
                </span>
                {selectedCaptionId === caption.id && <Check size={17} />}
              </button>
            ))}
          </div>
        )}

        {settingsPane === "captions-customize" && (
          <div className="animate-pane-in max-h-64 overflow-y-auto pr-1 select-scrollbar-hidden">
            <SubtitleCustomizer />
          </div>
        )}

        {settingsPane === "audio" && (
          <div className="space-y-1 animate-pane-in max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden">
            {audioTracks.length === 0 ? (
              <div className="px-3 py-4 text-sm text-chrome-zinc-400">
                Original audio
              </div>
            ) : (
              audioTracks.map((track) => {
                const unavailable = track.available === false;
                return (
                  <button
                    key={track.id}
                    type="button"
                    disabled={unavailable}
                    title={unavailable ? "This audio track isn't available for this video" : undefined}
                    onClick={() => {
                      if (unavailable) return;
                      setSelectedAudioTrackId(track.id);
                      setSettingsPane("root");
                    }}
                    className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                      unavailable ? "cursor-not-allowed opacity-40" : "hover:bg-chrome-white/10"
                    }`}
                  >
                    <span className="text-left">
                      {track.label}
                      {track.languageCode && (
                        <span className="ml-1 text-xs text-chrome-zinc-400">
                          {track.languageCode}
                        </span>
                      )}
                    </span>
                    {unavailable ? (
                      <span className="text-xs text-chrome-zinc-500">Unavailable</span>
                    ) : (
                      (selectedAudioTrackId === track.id ||
                        (!selectedAudioTrackId && track.isDefault)) && <Check size={17} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}

        {settingsPane === "sleep" && (
          <div className="space-y-1 animate-pane-in max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden">
            {sleepOptions.map((option) => (
              <button
                key={option.minutes}
                type="button"
                onClick={() => {
                  setSleepMinutes(option.minutes);
                  setSettingsPane("root");
                }}
                className="flex h-10 w-full items-center justify-between rounded-md px-3 text-sm font-medium hover:bg-chrome-white/10"
              >
                <span>{option.label}</span>
                {sleepMinutes === option.minutes && <Check size={17} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {submitDialogOpen && currentVideo && (
        <SponsorBlockSubmitDialog
          videoId={currentVideo.id}
          currentSeconds={submitAtSeconds}
          onClose={() => setSubmitDialogOpen(false)}
        />
      )}
    </>
  );
};

export default FlowPlayerControls;
