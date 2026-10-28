import React, { useEffect, useLayoutEffect, useRef } from "react";
import {
  AudioLines,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Monitor,
  Pause,
  Sliders,
  SlidersHorizontal,
} from "lucide-react";
import type { PlaybackRate } from "../../store/usePlayerStore";
import type { AudioTrack, CaptionTrack, StreamVariant } from "../../types/video";
import { SubtitleCustomizer } from "./SubtitleCustomizer";
import { SleepTimerLabel } from "../sleep/SleepTimerLabel";
import { SleepTimerPanel } from "../sleep/SleepTimerPanel";
import { useEqActive } from "../../lib/audio/eq/useEqualizer";
import { videoEqAvailable } from "../../lib/audio/mediaEqEngine";
import { useEqStore } from "../../store/useEqStore";
import { videoCodecLabel } from "../../lib/settings/playerRuntime";
import { getString } from "../../lib/i18n/index";
import { MOTION_EASE, motionMs } from "../../lib/motion";
import { PLAYER_MENU_ATTR } from "../../lib/playerMenuDismiss";

export type SettingsPane =
  | "root"
  | "speed"
  | "quality"
  | "captions"
  | "captions-translate"
  | "captions-customize"
  | "audio"
  | "sleep";

// How deep a pane sits, so going deeper slides in from the right and going back from the left.
const PANE_DEPTH: Record<SettingsPane, number> = {
  root: 0,
  speed: 1,
  quality: 1,
  captions: 1,
  audio: 1,
  sleep: 1,
  "captions-translate": 2,
  "captions-customize": 2,
};
const PANE_SLIDE_PX = 16;

const PANE_TITLE = {
  speed: "player_menu_speed",
  quality: "player_menu_quality",
  captions: "player_menu_subtitles",
  "captions-translate": "player_captions_auto_translate",
  "captions-customize": "player_menu_subtitle_style",
  audio: "player_menu_audio",
  sleep: "sleep_timer",
} as const satisfies Record<Exclude<SettingsPane, "root">, string>;

const ROW = "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-200 ease-out";
const LIST = "space-y-0.5 max-h-60 overflow-y-auto pr-1 select-scrollbar-hidden";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function speedLabel(speed: number) {
  return speed === 1 ? getString("player_menu_speed_normal") : `${speed}x`;
}

export function qualityLabel(selectedQualityId: string, qualities: StreamVariant[], activeQualityLabel?: string) {
  if (selectedQualityId === "auto") {
    return activeQualityLabel
      ? getString("player_menu_quality_auto_with", activeQualityLabel)
      : getString("player_menu_quality_auto");
  }
  return qualities.find((q) => q.id === selectedQualityId)?.qualityLabel || getString("player_menu_quality_auto");
}

interface PlayerSettingsMenuProps {
  open: boolean;
  pane: SettingsPane;
  onPaneChange: (pane: SettingsPane) => void;
  onClose: () => void;
  qualities: StreamVariant[];
  selectedQualityId: string;
  activeQualityLabel?: string;
  isDashPlayback: boolean;
  onSelectQuality?: (variant: StreamVariant | "auto") => void;
  captions: CaptionTrack[];
  selectedCaptionId: string;
  setSelectedCaptionId: (id: string) => void;
  audioTracks: AudioTrack[];
  selectedAudioTrackId?: string | null;
  setSelectedAudioTrackId: (id: string | null) => void;
  speedOptions: PlaybackRate[];
  speedSliderEnabled: boolean;
  playbackRate: PlaybackRate;
  onSelectPlaybackRate: (rate: PlaybackRate) => void;
}

export function PlayerSettingsMenu({
  open,
  pane,
  onPaneChange,
  onClose,
  qualities,
  selectedQualityId,
  activeQualityLabel,
  isDashPlayback,
  onSelectQuality,
  captions,
  selectedCaptionId,
  setSelectedCaptionId,
  audioTracks,
  selectedAudioTrackId,
  setSelectedAudioTrackId,
  speedOptions,
  speedSliderEnabled,
  playbackRate,
  onSelectPlaybackRate,
}: PlayerSettingsMenuProps) {
  const eqActive = useEqActive();
  const eqEditorHosted = useEqStore((s) => s.editorHosted);
  const openEqEditor = useEqStore((s) => s.setEditorOpen);

  const panesRef = useRef<HTMLDivElement>(null);
  const shownPaneRef = useRef(pane);
  const wasOpenRef = useRef(open);
  const settledHeightRef = useRef<number | null>(null);

  // The height a pane change starts from, kept current while nothing is animating.
  useEffect(() => {
    const box = panesRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (box.getAnimations().length === 0) settledHeightRef.current = box.offsetHeight;
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const box = panesRef.current;
    const previous = shownPaneRef.current;
    const wasOpen = wasOpenRef.current;
    shownPaneRef.current = pane;
    wasOpenRef.current = open;
    if (!box || previous === pane) return;
    const from = settledHeightRef.current;
    const to = box.offsetHeight;
    settledHeightRef.current = to;
    const duration = motionMs("--motion-pane");
    // A menu that is just opening shows its pane at once; only moves inside an open menu slide.
    if (!open || !wasOpen || from === null || duration <= 0 || typeof box.animate !== "function") return;
    const direction = PANE_DEPTH[pane] >= PANE_DEPTH[previous] ? 1 : -1;
    box.getAnimations().forEach((animation) => animation.cancel());
    box.animate(
      [
        { height: `${from}px`, opacity: 0, transform: `translateX(${direction * PANE_SLIDE_PX}px)` },
        { height: `${to}px`, opacity: 1, transform: "none" },
      ],
      { duration, easing: MOTION_EASE },
    );
  }, [pane, open]);

  const selectedCaption = captions.find((caption) => caption.id === selectedCaptionId) || null;
  const nativeCaptions = captions.filter((caption) => !caption.isTranslation);
  const translatedCaptions = captions.filter((caption) => caption.isTranslation);
  const captionLabel = (caption: CaptionTrack) =>
    caption.isTranslation ? getString("player_captions_translated_label", caption.label) : caption.label;
  const selectedAudioTrack =
    audioTracks.find((track) => track.id === selectedAudioTrackId) ||
    audioTracks.find((track) => track.isDefault) ||
    audioTracks[0] ||
    null;
  const audioPlayable = (quality: StreamVariant) =>
    isDashPlayback || quality.hasAudio || audioTracks.some((track) => !!track.localUrl);

  const pick = (apply: () => void, close = false) => {
    apply();
    if (close) onClose();
    else onPaneChange("root");
  };

  const settingRow = (label: string, value: React.ReactNode, icon: React.ReactNode, onClick: () => void) => (
    <button type="button" onClick={onClick} className={cx(ROW, "h-10 py-0 text-chrome-zinc-100 hover:bg-chrome-white/10")}>
      <span className="grid h-6 w-6 shrink-0 place-items-center text-chrome-zinc-300">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <span className="max-w-[46%] truncate text-right font-normal text-chrome-zinc-400">{value}</span>
      <ChevronRight size={16} className="shrink-0 text-chrome-zinc-500" />
    </button>
  );

  const check = (on: boolean) => (on ? <Check size={17} className="shrink-0 text-chrome-white" /> : null);

  return (
    <div
      {...{ [PLAYER_MENU_ATTR]: "" }}
      role="menu"
      aria-label={getString("player_menu_settings")}
      className={cx(
        "absolute bottom-20 right-3 z-40 flex max-h-[calc(100%-6rem)] w-[min(92vw,320px)] origin-bottom-right flex-col overflow-hidden rounded-xl border border-chrome-white/10 bg-chrome-popover/95 p-1.5 text-chrome-white transition-[opacity,transform,visibility] sm:right-5",
        open
          ? "visible scale-100 opacity-100 duration-[var(--motion-menu-in)] ease-[var(--motion-ease)]"
          : "invisible pointer-events-none scale-[0.98] opacity-0 duration-[var(--motion-menu-out)] ease-[var(--motion-ease-exit)]",
      )}
    >
      <div ref={panesRef} className="min-h-0 overflow-y-auto select-scrollbar-hidden">
        {pane !== "root" && (
          <div className="mb-0.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                onPaneChange(pane === "captions-customize" || pane === "captions-translate" ? "captions" : "root")
              }
              className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg pl-1.5 pr-3 text-left text-sm font-semibold transition-colors duration-200 ease-out hover:bg-chrome-white/10"
            >
              <ChevronLeft size={18} />
              {getString(PANE_TITLE[pane])}
            </button>
            {pane === "captions" && (
              <button
                type="button"
                title={getString("player_menu_subtitle_style_open")}
                aria-label={getString("player_menu_subtitle_style_open")}
                onClick={() => onPaneChange("captions-customize")}
                className="grid h-9 w-9 place-items-center rounded-lg text-chrome-zinc-300 transition-colors duration-200 ease-out hover:bg-chrome-white/10 hover:text-chrome-white"
              >
                <Sliders size={17} />
              </button>
            )}
          </div>
        )}

        {pane === "root" && (
          <div className="space-y-0.5">
            {settingRow(getString("player_menu_speed"), speedLabel(playbackRate), <Gauge size={18} />, () => onPaneChange("speed"))}
            {settingRow(
              getString("player_menu_quality"),
              qualityLabel(selectedQualityId, qualities, activeQualityLabel),
              <Monitor size={18} />,
              () => onPaneChange("quality"),
            )}
            {settingRow(
              getString("player_menu_subtitles"),
              selectedCaption ? captionLabel(selectedCaption) : getString("player_menu_subtitles_off"),
              <Captions size={18} />,
              () => onPaneChange("captions"),
            )}
            {settingRow(
              getString("player_menu_subtitle_style"),
              getString("player_menu_subtitle_style_value"),
              <Sliders size={18} />,
              () => onPaneChange("captions-customize"),
            )}
            {settingRow(
              getString("player_menu_audio"),
              selectedAudioTrack?.label || getString("player_menu_audio_original"),
              <AudioLines size={18} />,
              () => onPaneChange("audio"),
            )}
            {settingRow(getString("sleep_timer"), <SleepTimerLabel />, <Pause size={18} />, () => onPaneChange("sleep"))}
            {eqEditorHosted &&
              settingRow(
                getString("music_equalizer"),
                // Read when the menu draws: the self-test only settles once the equalizer is used.
                getString(!videoEqAvailable() ? "eq_state_unavailable" : eqActive ? "eq_state_on" : "eq_state_off"),
                <SlidersHorizontal size={18} />,
                () => {
                  onClose();
                  openEqEditor(true);
                },
              )}
          </div>
        )}

        {pane === "speed" && (
          <div className={LIST}>
            {speedSliderEnabled && (
              <div className="rounded-lg px-3 py-3 text-sm text-chrome-zinc-100">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-chrome-zinc-300">
                  <span>{getString("player_menu_speed_label")}</span>
                  <span className="font-mono text-primary">{playbackRate}x</span>
                </div>
                <input
                  aria-label={getString("player_menu_speed")}
                  type="range"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={playbackRate}
                  onChange={(event) => onSelectPlaybackRate(Number(event.target.value) as PlaybackRate)}
                  className="h-1 w-full accent-primary"
                />
              </div>
            )}
            {speedOptions.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => pick(() => onSelectPlaybackRate(speed))}
                className={cx(ROW, "hover:bg-chrome-white/10")}
              >
                <span>{speedLabel(speed)}</span>
                {check(playbackRate === speed)}
              </button>
            ))}
          </div>
        )}

        {pane === "quality" && (
          <div className={LIST}>
            <button
              type="button"
              onClick={() => pick(() => onSelectQuality?.("auto"), true)}
              className={cx(ROW, "text-chrome-zinc-100 hover:bg-chrome-white/10")}
            >
              <span className="flex items-center gap-1.5">
                <span>{getString("player_menu_quality_auto")}</span>
                {selectedQualityId === "auto" && activeQualityLabel && (
                  <span className="text-xs font-normal text-chrome-zinc-400">({activeQualityLabel})</span>
                )}
              </span>
              {check(selectedQualityId === "auto")}
            </button>

            {qualities.map((quality) => {
              const codec = videoCodecLabel(quality.mimeType);
              const playable = audioPlayable(quality);
              return (
                <button
                  key={quality.id}
                  type="button"
                  onClick={() => {
                    if (!playable) return;
                    pick(() => onSelectQuality?.(quality), true);
                  }}
                  className={cx(
                    ROW,
                    "text-chrome-zinc-100",
                    playable ? "hover:bg-chrome-white/10" : "cursor-not-allowed text-chrome-zinc-500",
                  )}
                >
                  <span className="flex flex-col text-left leading-tight">
                    <span>{quality.qualityLabel}</span>
                    {codec && <span className="text-xs font-normal text-chrome-zinc-400">{codec}</span>}
                  </span>
                  {check(selectedQualityId === quality.id)}
                </button>
              );
            })}
          </div>
        )}

        {pane === "captions" && (
          <div className={LIST}>
            <button
              type="button"
              onClick={() => pick(() => setSelectedCaptionId("off"))}
              className={cx(ROW, "hover:bg-chrome-white/10")}
            >
              <span>{getString("player_menu_subtitles_off")}</span>
              {check(selectedCaptionId === "off")}
            </button>
            {nativeCaptions.map((caption) => (
              <button
                key={caption.id}
                type="button"
                onClick={() => pick(() => setSelectedCaptionId(caption.id))}
                className={cx(ROW, "hover:bg-chrome-white/10")}
              >
                <span>
                  {caption.label}
                  {caption.isAutoGenerated && (
                    <span className="ml-1 text-xs font-normal text-chrome-zinc-400">
                      {getString("player_menu_subtitles_auto")}
                    </span>
                  )}
                </span>
                {check(selectedCaptionId === caption.id)}
              </button>
            ))}
            {translatedCaptions.length > 0 && (
              <button
                type="button"
                onClick={() => onPaneChange("captions-translate")}
                className={cx(ROW, "hover:bg-chrome-white/10")}
              >
                <span>{getString("player_captions_auto_translate")}</span>
                <span className="flex items-center gap-1 text-xs font-normal text-chrome-zinc-400">
                  {selectedCaption?.isTranslation ? selectedCaption.label : null}
                  <ChevronRight size={16} />
                </span>
              </button>
            )}
          </div>
        )}

        {pane === "captions-translate" && (
          <div className={LIST}>
            {translatedCaptions.map((caption) => (
              <button
                key={caption.id}
                type="button"
                onClick={() => pick(() => setSelectedCaptionId(caption.id))}
                className={cx(ROW, "hover:bg-chrome-white/10")}
              >
                <span>{caption.label}</span>
                {check(selectedCaptionId === caption.id)}
              </button>
            ))}
          </div>
        )}

        {pane === "captions-customize" && (
          <div className="max-h-64 overflow-y-auto pr-1 select-scrollbar-hidden">
            <SubtitleCustomizer />
          </div>
        )}

        {pane === "audio" && (
          <div className={LIST}>
            {audioTracks.length === 0 ? (
              <div className="px-3 py-4 text-sm text-chrome-zinc-400">{getString("player_menu_audio_original_only")}</div>
            ) : (
              audioTracks.map((track) => {
                const unavailable = track.available === false;
                return (
                  <button
                    key={track.id}
                    type="button"
                    disabled={unavailable}
                    title={unavailable ? getString("player_menu_audio_unavailable_hint") : undefined}
                    onClick={() => {
                      if (!unavailable) pick(() => setSelectedAudioTrackId(track.id));
                    }}
                    className={cx(ROW, unavailable ? "cursor-not-allowed opacity-40" : "hover:bg-chrome-white/10")}
                  >
                    <span>
                      {track.label}
                      {track.languageCode && (
                        <span className="ml-1 text-xs font-normal text-chrome-zinc-400">{track.languageCode}</span>
                      )}
                    </span>
                    {unavailable ? (
                      <span className="text-xs text-chrome-zinc-500">{getString("player_menu_audio_unavailable")}</span>
                    ) : (
                      check(selectedAudioTrackId === track.id || (!selectedAudioTrackId && !!track.isDefault))
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}

        {pane === "sleep" && (
          <div className={LIST}>
            <SleepTimerPanel tone="video" onDone={() => onPaneChange("root")} />
          </div>
        )}
      </div>
    </div>
  );
}
