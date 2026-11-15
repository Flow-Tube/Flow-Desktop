import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";

import { sungLineAt } from "../../../lib/lyrics/sungLine";
import { useLyricsStore } from "../../../store/useLyricsStore";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import type { SongItem } from "../../../types/music";

const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LINE = "line-clamp-1 text-[13px] font-medium";

/**
 * The line being sung in place of the artist, filled as it is sung, as Android's mini player does.
 * Lines fade into each other in a row one line tall, so the title above never moves; between lines
 * and for unsynced lyrics it shows the artist.
 */
export function MiniLyricsLine({ track, artist }: { track: SongItem; artist: string }) {
  const lyricsFor = useLyricsStore((s) => s.videoId);
  const entries = useLyricsStore((s) => s.entries);
  const isSynced = useLyricsStore((s) => s.isSynced);
  const offsetMs = useLyricsStore((s) => s.syncOffsetMs);
  const progress = useMusicPlayerStore((s) => s.progress);
  const ours = lyricsFor === (track.videoId ?? track.id) && isSynced;
  const line = ours ? sungLineAt(entries, progress * 1000 + offsetMs) : null;
  const fill = `${Math.round((line?.fill ?? 0) * 1000) / 10}%`;
  const towards = line && RIGHT_TO_LEFT.test(line.text) ? "to left" : "to right";

  return (
    <div className="relative mt-0.5 h-[18px] overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={line ? `line-${line.index}` : "artist"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="absolute inset-0"
        >
          {line ? (
            // As wide as its text, so the fill's share is of the words and not of the row.
            <div
              dir="auto"
              className="inline-block max-w-full truncate bg-clip-text align-top text-[13px] font-medium text-transparent"
              style={{
                backgroundImage: `linear-gradient(${towards}, var(--color-chrome-neutral-100) ${fill}, var(--color-chrome-neutral-500) ${fill})`,
              } as CSSProperties}
            >
              {line.text}
            </div>
          ) : (
            <div dir="auto" className={`${LINE} text-chrome-neutral-400`}>
              {artist}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
