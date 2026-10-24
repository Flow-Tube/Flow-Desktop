import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

import type { LyricsEntry } from "../../lib/lyrics/types";
import type { Rgb } from "../../lib/useDominantColor";
import { entriesAreSynced } from "../../lib/lyrics/sync";
import { getString } from "../../lib/i18n/index";
import { LyricsCanvas } from "./LyricsCanvas";

const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

function buildLines(entries: LyricsEntry[], plain: string | null, synced: boolean): LyricsEntry[] {
  if (synced && entries.length > 0) {
    const sorted = [...entries].sort((a, b) => a.time - b.time);
    return [{ time: 0, text: "" }, ...sorted];
  }
  const src = plain ?? entries.map((e) => e.text).join("\n");
  return src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((text, i) => ({ time: 1_000_000 + i, text }));
}

interface MusicLyricsProps {
  entries: LyricsEntry[];
  plain: string | null;
  isSynced: boolean;
  loading: boolean;
  providerName: string;
  /** A credit shown under plain lyrics, as their source requires. */
  source?: string | null;
  /** The player's control colour; lyrics are drawn in it, as on Android. */
  accent: Rgb;
  onSeek: (seconds: number) => void;
  className?: string;
}

export function MusicLyrics({
  entries,
  plain,
  isSynced,
  loading,
  providerName,
  source,
  accent,
  onSeek,
  className = "",
}: MusicLyricsProps) {
  const synced = isSynced && entriesAreSynced(entries);
  const lines = buildLines(entries, plain, synced);
  const expressive = accent;

  if (loading) {
    return (
      <div className={`grid place-items-center ${className}`}>
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: rgba(expressive, 0.8) }} />
      </div>
    );
  }

  if (lines.length === 0 || (!synced && !plain && entries.length === 0)) {
    return (
      <div className={`grid place-items-center ${className}`}>
        <p className="text-lg text-chrome-neutral-400">{getString("music_lyrics_unavailable")}</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {synced ? (
        <LyricsCanvas lines={lines} accent={expressive} onSeek={onSeek} className="h-full w-full" />
      ) : (
        <div
          className="hide-scrollbar h-full overflow-y-auto px-6"
          style={{
            maskImage: "linear-gradient(to bottom, transparent 0%, #000 15%, #000 80%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 15%, #000 80%, transparent 100%)",
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 py-[28vh] text-center">
            {lines.map((line, i) => (
              <p
                key={i}
                className="font-extrabold leading-snug tracking-tight"
                style={{ color: rgba(expressive, 0.82), fontSize: "clamp(1.6rem,2.6vw,2.2rem)" }}
              >
                {line.text}
              </p>
            ))}
            {source ? (
              <p className="mt-6 text-sm font-medium" style={{ color: rgba(expressive, 0.55) }}>
                {source}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {providerName ? <ProviderTag name={providerName} accent={expressive} /> : null}
    </div>
  );
}

function ProviderTag({ name, accent }: { name: string; accent: Rgb }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 3000);
    return () => window.clearTimeout(t);
  }, [name]);
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 text-xs uppercase tracking-widest"
          style={{ color: rgba(accent, 0.6) }}
        >
          {name}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
