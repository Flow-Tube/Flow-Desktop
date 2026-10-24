import { useCallback, useMemo } from "react";

import type { SongItem } from "../../types/music";
import type { Rgb } from "../../lib/useDominantColor";
import type { LyricsAlign } from "../../lib/lyrics/display/presentation";
import { useLyrics } from "../../lib/lyrics/useLyrics";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useBoolPref, usePreference } from "../../lib/usePreference";
import { SETTINGS } from "../../lib/settings/schema";
import { useTheme } from "../../lib/useTheme";
import { LyricsPanel } from "./lyrics/LyricsPanel";

/**
 * Android's LARGE (44) and PANE (30) lyric sizes, in CSS px: the full-bleed view reads from a
 * distance like a tablet's, the side pane is narrower than a phone.
 */
const TEXT_SIZE = { full: 44, pane: 30 } as const;
/** A full-width desktop window would make lines too long to read, so rows stop growing here. */
const MAX_ROW_WIDTH = { full: 1100, pane: Number.POSITIVE_INFINITY } as const;

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

const isAlign = (value: string): value is LyricsAlign => value === "left" || value === "center" || value === "right";

export interface MusicLyricsProps {
  track: SongItem | null;
  /** The full-bleed lyrics view, or a side pane next to the song. */
  variant: "full" | "pane";
  /** The player's accent. It is used once there is a `backdrop` to check its contrast against. */
  accent: Rgb | null;
  /** The colour the lyrics are drawn over. Without one the lyrics use the theme's text colour. */
  backdrop: Rgb | null;
  /** False while the host keeps the lyrics mounted but out of sight: their loops stop. */
  active: boolean;
  className?: string;
}

/** The lyrics of the song playing, for the full-bleed view or a side pane. */
export function MusicLyrics({ track, variant, accent, backdrop, active, className = "" }: MusicLyricsProps) {
  const lyrics = useLyrics(track);
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  const seek = useMusicPlayerStore((s) => s.seek);
  const [alignPref] = usePreference(SETTINGS.LYRICS_TEXT_ALIGN);
  const [showTranslation] = useBoolPref(SETTINGS.LYRICS_SHOW_TRANSLATION);
  const [showRomanization] = useBoolPref(SETTINGS.LYRICS_SHOW_ROMANIZATION);
  const { theme, variant: themeVariant } = useTheme();
  const textColor = useMemo(() => hexToRgb(theme.variants[themeVariant].onSurface), [theme, themeVariant]);
  const lyricAccent = backdrop && accent ? accent : textColor;

  const onSeekTo = useCallback((lineTimeMs: number) => seek(lineTimeMs / 1000), [seek]);

  return (
    <div className={`relative ${className}`}>
      <LyricsPanel
        lyrics={lyrics.plain}
        syncedLyrics={lyrics.isSynced ? lyrics.entries : []}
        isLoading={lyrics.loading}
        providerName={lyrics.providerName}
        accent={lyricAccent}
        backdrop={backdrop}
        baseTextSize={TEXT_SIZE[variant]}
        maxRowWidth={MAX_ROW_WIDTH[variant]}
        textAlign={isAlign(alignPref) ? alignPref : "center"}
        showTranslation={showTranslation}
        showRomanization={showRomanization}
        syncOffsetMs={0}
        active={active}
        isPlaying={isPlaying}
        onSeekTo={onSeekTo}
        className="h-full w-full"
      />
      {lyrics.source && !lyrics.isSynced && (
        <p className="pointer-events-none absolute inset-x-0 top-[58px] z-10 text-center text-xs font-medium text-chrome-neutral-400">
          {lyrics.source}
        </p>
      )}
    </div>
  );
}
