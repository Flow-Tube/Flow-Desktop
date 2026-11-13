import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Droplet,
  Frame,
  Loader2,
  Maximize,
  Quote,
  RectangleVertical,
  Shapes,
  Square,
  SquareDashed,
  TextQuote,
  Type,
} from "lucide-react";

import type { SongItem } from "../../../types/music";
import { musicAudioEngine } from "../../../lib/audio/musicAudioEngine";
import { css } from "../../../lib/color/tone";
import { getString } from "../../../lib/i18n/index";
import { MESH_SIZE } from "../../../lib/lyrics/display/coverMesh";
import type { CardAlign, CardAspect, CardFrame, CardLayout } from "../../../lib/lyrics/lyricCardRenderer";
import { backdropColor, CARD_STYLE_LABELS, type CardStyle, type CardStyleId } from "../../../lib/lyrics/palette";
import { MAX_SHARE_LINES, shareLineIndexAt, shareLines, toggleShareLine } from "../../../lib/lyrics/shareSelection";
import { useLyricCardArtwork, useLyricCardImage } from "../../../lib/lyrics/useLyricCard";
import { upgradeMusicImageUrl } from "../../../lib/thumbnails";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { LyricsDialog } from "./LyricsDialog";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const TITLE_ID = "lyrics-share-title";
const ICON = "h-4 w-4";

const layoutOptions = () => [
  { value: "classic" as const, label: getString("lyrics_share_layout_classic"), icon: <TextQuote className={ICON} /> },
  { value: "poster" as const, label: getString("lyrics_share_layout_poster"), icon: <Quote className={ICON} /> },
  { value: "shape" as const, label: getString("lyrics_share_layout_shape"), icon: <Shapes className={ICON} /> },
];
const aspectOptions = () => [
  { value: "fit" as const, label: getString("lyrics_share_size_fit"), icon: <Maximize className={ICON} /> },
  { value: "square" as const, label: getString("lyrics_share_size_square"), icon: <Square className={ICON} /> },
  { value: "story" as const, label: getString("lyrics_share_size_story"), icon: <RectangleVertical className={ICON} /> },
];
const frameOptions = () => [
  { value: "square" as const, label: getString("lyrics_share_frame_square"), icon: <SquareDashed className={ICON} /> },
  { value: "backdrop" as const, label: getString("lyrics_share_frame_backdrop"), icon: <Frame className={ICON} /> },
  { value: "clear" as const, label: getString("lyrics_share_frame_clear"), icon: <Droplet className={ICON} /> },
];
const alignOptions = () => [
  { value: "left" as const, label: getString("lyrics_share_align_left"), icon: <AlignLeft className={ICON} /> },
  { value: "center" as const, label: getString("lyrics_share_align_center"), icon: <AlignCenter className={ICON} /> },
  { value: "right" as const, label: getString("lyrics_share_align_right"), icon: <AlignRight className={ICON} /> },
];

/** The cover's colour field as a small image, for its swatch. */
function meshUrl(mesh: Uint8ClampedArray): string {
  const canvas = document.createElement("canvas");
  canvas.width = MESH_SIZE;
  canvas.height = MESH_SIZE;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(mesh), MESH_SIZE, MESH_SIZE), 0, 0);
  return canvas.toDataURL();
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-chrome-neutral-500">{label}</span>
      {children}
    </div>
  );
}

function Swatches({ styles, selected, onSelect }: { styles: CardStyle[]; selected: CardStyleId | undefined; onSelect: (id: CardStyleId) => void }) {
  const cover = styles.find((style) => style.mesh)?.mesh;
  const coverUrl = useMemo(() => (cover ? meshUrl(cover) : undefined), [cover]);
  return (
    <div role="radiogroup" aria-label={getString("lyrics_share_style")} className="flex max-w-72 flex-wrap gap-3 p-1">
      {styles.map((option) => {
        const isSelected = option.id === selected;
        const label = getString(CARD_STYLE_LABELS[option.id]);
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={label}
            title={label}
            onClick={() => onSelect(option.id)}
            className={`grid h-9 w-9 place-items-center rounded-full border border-chrome-neutral-800 bg-cover bg-center transition-transform duration-200 ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container ${
              isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-container" : ""
            }`}
            style={{
              backgroundColor: css(option.ground),
              backgroundImage: option.mesh && coverUrl ? `url("${coverUrl}")` : undefined,
              color: css(option.ink),
            }}
          >
            {isSelected && <Check className="h-4 w-4" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Picks up to five lyric lines, then styles the card they make and copies or saves it, as Android's
 * LyricsShareSheet does: its colours, layouts, sizes, edges and alignment, and copying the lines as text.
 */
export function LyricsShareDialog({ track, initialAlign, onClose }: { track: SongItem | null; initialAlign: CardAlign; onClose: () => void }) {
  const entries = useLyricsStore((s) => s.entries);
  const plain = useLyricsStore((s) => s.plain);
  const syncOffsetMs = useLyricsStore((s) => s.syncOffsetMs);
  const currentTrack = useMusicPlayerStore((s) => s.currentTrack);
  const song = track ?? currentTrack;

  const lines = useMemo(() => shareLines(entries, plain ?? ""), [entries, plain]);
  // Read once: the picker opens at the line being sung and doesn't follow playback.
  const [playingIndex] = useState(() => shareLineIndexAt(lines, musicAudioEngine.getCurrentTime() * 1000 + syncOffsetMs));
  const [selected, setSelected] = useState<number[]>([]);
  const [step, setStep] = useState<"select" | "style">("select");
  // Held here so going back to change the lines keeps the look already picked.
  const [styleId, setStyleId] = useState<CardStyleId>("artwork");
  const [align, setAlign] = useState<CardAlign>(initialAlign);
  const [layout, setLayout] = useState<CardLayout>("classic");
  const [aspect, setAspect] = useState<CardAspect>("fit");
  const [frame, setFrame] = useState<CardFrame>("square");
  const playingRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    playingRef.current?.scrollIntoView?.({ block: "center" });
  }, []);

  const artwork = useLyricCardArtwork(useMemo(() => upgradeMusicImageUrl(song?.thumbnail, 512), [song?.thumbnail]));
  const styles = artwork?.colors.styles;
  const style = styles?.find((candidate) => candidate.id === styleId) ?? styles?.[0] ?? null;
  const artist = song?.artists.map((a) => a.name).filter(Boolean).join(", ") ?? "";
  const data = useMemo(
    () =>
      step === "style" && selected.length > 0
        ? { lines: selected.map((index) => lines[index]!.text), title: song?.title ?? "", artist }
        : null,
    [step, selected, lines, song?.title, artist],
  );
  const look = useMemo(
    () =>
      style && artwork
        ? { style, align, layout, aspect, frame, backdrop: backdropColor(style.ground, artwork.colors) }
        : null,
    [style, artwork, align, layout, aspect, frame],
  );
  const card = useLyricCardImage(data, look, artwork?.art ?? null);
  const subtitle = getString("lyrics_share_lines_selected", selected.length, MAX_SHARE_LINES);

  if (step === "select") {
    return (
      <LyricsDialog
        key="select"
        title={getString("lyrics_share_title")}
        titleId={TITLE_ID}
        onClose={onClose}
        footer={
          <>
            <span className="me-auto self-center text-sm tabular-nums text-chrome-neutral-400">{subtitle}</span>
            <Button disabled={selected.length === 0} onClick={() => setStep("style")} className={FOCUS}>
              {getString("next")}
            </Button>
          </>
        }
      >
        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-chrome-neutral-400">{getString("music_lyrics_unavailable")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {lines.map((line, index) => {
              const isSelected = selected.includes(index);
              return (
                <button
                  key={index}
                  ref={index === playingIndex ? playingRef : undefined}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={!isSelected && selected.length >= MAX_SHARE_LINES}
                  onClick={() => setSelected((current) => toggleShareLine(current, index))}
                  className={`w-full rounded-xl px-4 py-3 text-start transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS} ${
                    isSelected
                      ? "bg-surface-container-highest text-chrome-neutral-100"
                      : "text-chrome-neutral-300 hover:bg-surface-container-high"
                  }`}
                >
                  <span dir="auto" className="block text-base font-semibold leading-snug">
                    {line.text}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </LyricsDialog>
    );
  }

  const ready = card.previewUrl !== null;
  return (
    <LyricsDialog
      key="style"
      title={getString("lyrics_share_title")}
      titleId={TITLE_ID}
      onClose={onClose}
      widthClass="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => setStep("select")} className={`me-auto ${FOCUS}`}>
            <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
            {getString("lyrics_share_back")}
          </Button>
          <Button variant="ghost" onClick={card.copyLines} className={FOCUS}>
            <Type className="h-4 w-4" />
            {getString("lyrics_share_copy_text")}
          </Button>
          <Button variant="tonal" disabled={!ready} onClick={() => void card.save()} className={FOCUS}>
            <Download className="h-4 w-4" />
            {getString("lyrics_share_save_image")}
          </Button>
          <Button disabled={!ready} onClick={card.copy} className={FOCUS}>
            <Copy className="h-4 w-4" />
            {getString("lyrics_share_copy_image")}
          </Button>
        </>
      }
    >
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid min-h-60 place-items-center">
          {card.previewUrl ? (
            <img
              src={card.previewUrl}
              alt={getString("lyrics_share_preview")}
              className={`max-h-[min(calc(100vh-17rem),440px)] w-auto max-w-full transition-opacity duration-200 ease-out ${card.rendering ? "opacity-70" : "opacity-100"}`}
            />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-chrome-neutral-400" />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {styles && styles.length > 1 && (
            <Control label={getString("lyrics_share_style")}>
              <Swatches styles={styles} selected={style?.id} onSelect={setStyleId} />
            </Control>
          )}
          <Control label={getString("lyrics_share_layout")}>
            <SegmentedControl<CardLayout> label={getString("lyrics_share_layout")} value={layout} onChange={setLayout} options={layoutOptions()} />
          </Control>
          <Control label={getString("lyrics_share_size")}>
            <SegmentedControl<CardAspect> label={getString("lyrics_share_size")} value={aspect} onChange={setAspect} options={aspectOptions()} />
          </Control>
          <Control label={getString("lyrics_share_frame")}>
            <SegmentedControl<CardFrame> label={getString("lyrics_share_frame")} value={frame} onChange={setFrame} options={frameOptions()} />
          </Control>
          <Control label={getString("lyrics_share_align")}>
            <SegmentedControl<CardAlign> label={getString("lyrics_share_align")} value={align} onChange={setAlign} options={alignOptions()} />
          </Control>
        </div>
      </div>
    </LyricsDialog>
  );
}
