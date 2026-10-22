import { Music2 } from "lucide-react";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayMusicCard } from "../../lib/usePlayMusicCard";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import { getString } from "../../lib/i18n/index";
import type { DescriptionExtras as Extras } from "../../types/video";

function SongCard({ song, onPlay }: { song: Extras["music"][number]; onPlay: () => void }) {
  const thumbnail = useProxiedImageUrl(song.thumbnailUrl ?? null);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
      }}
      className="flex min-w-0 items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-surface-container-high"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-high">
        {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover" /> : <Music2 size={18} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-chrome-neutral-100">{song.title}</span>
        <span className="block truncate text-xs text-chrome-neutral-400">
          {[song.artist, song.album].filter(Boolean).join(" • ")}
        </span>
      </span>
    </button>
  );
}

/** The structured part of an expanded description: headline numbers, credited songs, the creator's links. */
export function DescriptionExtras({ extras }: { extras: Extras }) {
  const playSong = usePlayMusicCard();
  const openTarget = useRichTargetHandler();
  if (extras.factoids.length === 0 && extras.music.length === 0 && extras.links.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-chrome-neutral-800 pt-4">
      {extras.factoids.length > 0 && (
        <div className="flex flex-wrap gap-6">
          {extras.factoids.map((factoid) => (
            <div key={`${factoid.label}-${factoid.value}`} className="flex flex-col">
              <span className="text-base font-semibold text-chrome-neutral-100">{factoid.value}</span>
              <span className="text-xs text-chrome-neutral-400">{factoid.label}</span>
            </div>
          ))}
        </div>
      )}

      {extras.music.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
            {getString("description_music")}
          </span>
          <div className="grid gap-1 sm:grid-cols-2">
            {extras.music.map((song) => (
              <SongCard key={`${song.title}-${song.artist ?? ""}`} song={song} onPlay={() => void playSong(song)} />
            ))}
          </div>
        </div>
      )}

      {extras.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {extras.links.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openTarget({ kind: "url", url: link.url });
              }}
              className="rounded-full border border-chrome-neutral-800 px-3 py-1 text-xs font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-high"
            >
              {link.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
