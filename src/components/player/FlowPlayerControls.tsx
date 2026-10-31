import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  Captions,
  ChevronRight,
  Expand,
  ListVideo,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  ScrollText,
  Settings as SettingsIcon,
  SkipBack,
  SkipForward,
  Shrink,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayerStore, type FullscreenPanel, type PlaybackRate } from "../../store/usePlayerStore";
import { useSettingsStore, type SponsorBlockCategory } from "../../store/useSettingsStore";
import type {
  AudioTrack,
  CaptionTrack,
  HeatmapMarker,
  StoryboardLevel,
  StreamVariant,
  VideoChapter,
} from "../../types/video";
import { HeatmapStrip } from "./HeatmapStrip";
import { PREVIEW_WIDTH, pickStoryboardLevel, storyboardFrameAt } from "../../lib/seekPreview";
import { proxiedImage } from "../../lib/imageProxy";
import { useImageProxyStore } from "../../store/useImageProxyStore";
import { PlayerSettingsMenu, qualityLabel, type SettingsPane } from "./PlayerSettingsMenu";
import { PlayOnButton } from "../playon/PlayOnButton";
import { PLAYER_MENU_OWNER_ATTR } from "../../lib/playerMenuDismiss";
import { SponsorBlockSubmitDialog } from "./SponsorBlockSubmitDialog";
import {
  PROGRESS_EVENTS,
  segmentFillPercent,
  setStyleIfChanged,
  setTextIfChanged,
  shouldAnimateProgress,
} from "../../lib/playerProgress";
import { SponsorBlockIcon } from "../ui/SponsorBlockIcon";
import { sponsorBlockCategoryLabel } from "../../lib/sponsorBlockCategories";
import { getString } from "../../lib/i18n/index";
import { Slider } from "../ui/Slider";
import { volumeAfterWheel } from "../../lib/musicPlayerKeys";

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
  /** The most-replayed graph drawn above the seek bar. */
  heatmap?: HeatmapMarker[];
  /** Preview frames shown while hovering the seek bar. */
  storyboard?: StoryboardLevel[];
  activeQualityLabel?: string;
}

const defaultSpeedOptions: PlaybackRate[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

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
  heatmap,
  storyboard,
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
    fullscreenPanel,
    setFullscreenPanel,
    isLiveChatAvailable,
  } = usePlayerStore();

  // In fullscreen the panel buttons drive the side panel beside the video instead of the sidebar.
  const panelOpen = (panel: FullscreenPanel) =>
    isFullscreen ? fullscreenPanel === panel : panel === "queue" ? isQueuePanelOpen : panel === "chapters" && isChaptersPanelOpen;
  const togglePanel = (panel: FullscreenPanel) => {
    if (isFullscreen) setFullscreenPanel(fullscreenPanel === panel ? null : panel);
    else if (panel === "queue") setIsQueuePanelOpen(!isQueuePanelOpen);
    else if (panel === "chapters") setIsChaptersPanelOpen(!isChaptersPanelOpen);
  };
  const panelButtonClass = (panel: FullscreenPanel) =>
    cx("grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10", panelOpen(panel) && "bg-chrome-white/15 text-primary/90");

  const { sponsorBlockColors, sponsorBlockEnabled, sbSubmitEnabled } = useSettingsStore();
  const selectPlaybackRate = onSelectPlaybackRate ?? setPlaybackRate;

  const [settingsPane, setSettingsPane] = useState<SettingsPane>("root");
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [submitAtSeconds, setSubmitAtSeconds] = useState(0);
  const chapterPillRef = useRef<HTMLButtonElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const durationTimeRef = useRef<HTMLSpanElement>(null);
  const hoverPillRef = useRef<HTMLDivElement>(null);
  const hoverTextRef = useRef<HTMLSpanElement>(null);
  const hoverSegmentRef = useRef<HTMLSpanElement>(null);
  const hoverSegmentDotRef = useRef<HTMLSpanElement>(null);
  const hoverSegmentLabelRef = useRef<HTMLSpanElement>(null);
  const hoverPreviewRef = useRef<HTMLDivElement>(null);
  const proxyBase = useImageProxyStore((state) => state.base);
  const previewLevel = pickStoryboardLevel(storyboard);
  const previewHeight = previewLevel ? Math.round((previewLevel.height * PREVIEW_WIDTH) / previewLevel.width) : 0;

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

  const bufferedPctRef = useRef(bufferedPct);
  useLayoutEffect(() => {
    bufferedPctRef.current = bufferedPct;
  }, [bufferedPct]);
  const animateProgress = shouldAnimateProgress(isPlaying, shouldShowControls, isScrubbing);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // `segments` is a dependency, so these fills are current for this run.
    const progressFills = [...container.querySelectorAll<HTMLElement>(".chapter-progress-fill")];
    const bufferedFills = [...container.querySelectorAll<HTMLElement>(".chapter-buffered-fill")];
    const chapterTitle = chapterPillRef.current?.querySelector<HTMLElement>(".chapter-title");
    let video = container.querySelector("video");

    const updateProgress = () => {
      if (!video?.isConnected) video = container.querySelector("video");
      if (!video) return;
      const cur = video.currentTime;

      // Live: the seekbar tracks the DVR window and the time shows real broadcast elapsed.
      if (isLive) {
        const { start, end } = liveWindow(video);
        const win = Math.max(1, end - start);
        const livePct = `${Math.min(100, Math.max(0, ((cur - start) / win) * 100))}%`;
        setStyleIfChanged(progressBarRef.current, "width", livePct);
        for (const fill of [...progressFills, ...bufferedFills]) setStyleIfChanged(fill, "width", livePct);
        setStyleIfChanged(playheadRef.current, "left", livePct);
        setStyleIfChanged(chapterPillRef.current, "display", "none");
        const offset = parseFloat(video.dataset.liveOffset || "0");
        setTextIfChanged(currentTimeRef.current, formatTime(cur + offset));
        return;
      }

      const dur = video.duration || duration || 0;
      const pct = `${dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0}%`;
      setStyleIfChanged(progressBarRef.current, "width", pct);
      setStyleIfChanged(playheadRef.current, "left", pct);

      for (const fill of progressFills) {
        const start = parseFloat(fill.dataset.start || "0");
        const end = parseFloat(fill.dataset.end || "0");
        setStyleIfChanged(fill, "width", `${segmentFillPercent(cur, start, end)}%`);
      }
      const bufferedTime = (bufferedPctRef.current / 100) * dur;
      for (const fill of bufferedFills) {
        const start = parseFloat(fill.dataset.start || "0");
        const end = parseFloat(fill.dataset.end || "0");
        setStyleIfChanged(fill, "width", `${segmentFillPercent(bufferedTime, start, end)}%`);
      }

      setTextIfChanged(currentTimeRef.current, formatTime(cur));
      setTextIfChanged(durationTimeRef.current, formatTime(dur));

      const activeChapter = segments?.find((c) => cur >= c.startSeconds && cur <= c.endSeconds);
      if (activeChapter?.title) {
        setStyleIfChanged(chapterPillRef.current, "display", "flex");
        setTextIfChanged(chapterTitle, activeChapter.title);
      } else {
        setStyleIfChanged(chapterPillRef.current, "display", "none");
      }
    };

    updateProgress();
    const source = video;
    for (const event of PROGRESS_EVENTS) source?.addEventListener(event, updateProgress);

    let frame: number | null = null;
    if (animateProgress) {
      const tick = () => {
        updateProgress();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const event of PROGRESS_EVENTS) source?.removeEventListener(event, updateProgress);
    };
  }, [animateProgress, containerRef, duration, segments, isLive]);

  const progressPct =
    duration > 0
      ? Math.min(100, Math.max(0, (usePlayerStore.getState().currentTime / duration) * 100))
      : 0;

  const supportedQualities = qualities;

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
    // A preview frame is wider than the pill's text; keep it inside the player.
    const half = previewLevel ? PREVIEW_WIDTH / 2 : 0;
    pill.style.left = `${Math.min(rect.width - half, Math.max(half, x))}px`;
    pill.style.opacity = "1";
    const time = (x / rect.width) * duration;
    const preview = hoverPreviewRef.current;
    if (preview && previewLevel) {
      // Sheets load only here, on hover, and each holds dozens of frames.
      const frame = storyboardFrameAt(previewLevel, time);
      const scale = PREVIEW_WIDTH / previewLevel.width;
      const url = proxiedImage(frame.url, proxyBase);
      if (preview.dataset.url !== url) {
        preview.dataset.url = url;
        preview.style.backgroundImage = `url("${url}")`;
      }
      preview.style.backgroundSize = `${frame.sheetWidth * scale}px ${frame.sheetHeight * scale}px`;
      preview.style.backgroundPosition = `-${frame.x * scale}px -${frame.y * scale}px`;
    }
    if (hoverTextRef.current) {
      const chapter = segments?.find((c) => time >= c.startSeconds && time <= c.endSeconds);
      hoverTextRef.current.textContent = chapter?.title
        ? `${formatTime(time)} • ${chapter.title}`
        : formatTime(time);
    }
    if (hoverSegmentRef.current && hoverSegmentDotRef.current && hoverSegmentLabelRef.current) {
      const sbSegment = sponsorBlockEnabled
        ? sponsorBlockSegments.find(
            (candidate) => time >= candidate.segment[0] && time <= candidate.segment[1],
          )
        : undefined;
      hoverSegmentRef.current.style.display = sbSegment ? "flex" : "none";
      if (sbSegment) {
        hoverSegmentDotRef.current.style.backgroundColor =
          sponsorBlockColors[sbSegment.category as SponsorBlockCategory] ||
          "var(--color-chrome-red-500)";
        hoverSegmentLabelRef.current.textContent = sponsorBlockCategoryLabel(sbSegment.category);
      }
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
            {!isLive && <HeatmapStrip markers={heatmap} duration={duration} />}

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
                {previewLevel && (
                  <div
                    ref={hoverPreviewRef}
                    className="mb-1.5 overflow-hidden rounded-lg border border-chrome-white/10 bg-chrome-black bg-no-repeat"
                    style={{ width: PREVIEW_WIDTH, height: previewHeight }}
                  />
                )}
                <div className="bg-chrome-black/80 border border-chrome-white/10 px-2 py-1 rounded-2xl text-chrome-white min-w-max text-center flex flex-col items-center gap-0.5 leading-tight">
                  <span ref={hoverTextRef} className="text-[12px] font-medium font-sans" />
                  <span
                    ref={hoverSegmentRef}
                    className="hidden items-center gap-1.5 text-[11px] font-semibold font-sans text-chrome-white/85"
                  >
                    <span ref={hoverSegmentDotRef} className="h-2 w-2 shrink-0 rounded-full" />
                    <span ref={hoverSegmentLabelRef} />
                  </span>
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

              <div
                className="group/volume hidden items-center sm:flex bg-chrome-black/20 rounded-full hover:pr-2"
                onWheel={(event) => {
                  event.stopPropagation();
                  const current = muted ? 0 : volume;
                  const next = volumeAfterWheel(current, event.deltaY);
                  setVolume(next);
                  setMuted(next === 0);
                }}
              >
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
                <div className="w-0 overflow-hidden opacity-0 transition-all group-hover/volume:w-20 group-hover/volume:opacity-100">
                  <Slider
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={(value) => {
                      setVolume(value);
                      setMuted(value === 0);
                    }}
                  />
                </div>

              </div>

              <div className="ml-1 flex items-center gap-1.5">
                <div className="whitespace-nowrap text-xs font-semibold text-chrome-white sm:text-sm bg-chrome-black/20 rounded-full px-2 py-1">
                  <span ref={currentTimeRef} />
                  {!isLive && (
                    <>
                      {" "}
                      <span className="text-chrome-zinc-400">/</span>{" "}
                      <span ref={durationTimeRef} />
                    </>
                  )}
                </div>
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
                onClick={() => togglePanel("chapters")}
                className="hidden items-center gap-1.5 text-xs font-medium text-chrome-white sm:text-sm bg-chrome-black/20 hover:bg-chrome-white/10 rounded-full px-2 py-1 transition-all select-none cursor-pointer active:scale-95 group/pill max-w-[150px] sm:max-w-[260px] truncate"
              >
                <span className="chapter-title truncate"></span>
                <ChevronRight size={14} className="text-chrome-zinc-400 group-hover/pill:text-chrome-white transition-colors shrink-0" />
              </button>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 bg-chrome-black/20 rounded-full px-1 py-1">
              {isFullscreen && (
                <button
                  type="button"
                  title={getString("player_panel_chapters")}
                  aria-label={getString("player_panel_chapters")}
                  aria-pressed={panelOpen("chapters")}
                  onClick={() => togglePanel("chapters")}
                  className={panelButtonClass("chapters")}
                >
                  <ScrollText size={19} />
                </button>
              )}
              <button
                type="button"
                title={getString("queue_title")}
                aria-label={getString("queue_title")}
                aria-pressed={panelOpen("queue")}
                onClick={() => togglePanel("queue")}
                className={panelButtonClass("queue")}
              >
                <ListVideo size={19} />
              </button>
              {isFullscreen && isLiveChatAvailable && (
                <button
                  type="button"
                  title={getString("live_chat_title")}
                  aria-label={getString("live_chat_title")}
                  aria-pressed={panelOpen("chat")}
                  onClick={() => togglePanel("chat")}
                  className={panelButtonClass("chat")}
                >
                  <MessageSquareText size={19} />
                </button>
              )}
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
                {...{ [PLAYER_MENU_OWNER_ATTR]: "" }}
                title={getString("player_menu_quality")}
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
                {qualityLabel(selectedQualityId || "auto", supportedQualities, activeQualityLabel)}
              </button>
              <button
                type="button"
                {...{ [PLAYER_MENU_OWNER_ATTR]: "" }}
                title={getString("player_menu_captions")}
                aria-label={getString("player_menu_captions")}
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
                {...{ [PLAYER_MENU_OWNER_ATTR]: "" }}
                title={getString("player_menu_settings")}
                aria-label={getString("player_menu_settings")}
                aria-expanded={settingsOpen}
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
              <PlayOnButton className="grid h-7 w-7 place-items-center rounded-full hover:bg-chrome-white/10" iconSize={19} />
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
              {!isFullscreen && (
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
              )}
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

      <PlayerSettingsMenu
        open={settingsOpen}
        pane={settingsPane}
        onPaneChange={setSettingsPane}
        onClose={() => setSettingsOpen(false)}
        qualities={supportedQualities}
        selectedQualityId={selectedQualityId || "auto"}
        activeQualityLabel={activeQualityLabel}
        isDashPlayback={isDashPlayback}
        onSelectQuality={onSelectQuality}
        captions={captions}
        selectedCaptionId={selectedCaptionId}
        setSelectedCaptionId={setSelectedCaptionId}
        audioTracks={audioTracks}
        selectedAudioTrackId={selectedAudioTrackId}
        setSelectedAudioTrackId={setSelectedAudioTrackId}
        speedOptions={speedOptions}
        speedSliderEnabled={speedSliderEnabled}
        playbackRate={playbackRate}
        onSelectPlaybackRate={selectPlaybackRate}
      />

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
