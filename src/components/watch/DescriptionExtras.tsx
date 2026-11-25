import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ListVideo, Music2, ScrollText } from "lucide-react";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import { usePlayMusicCard } from "../../lib/usePlayMusicCard";
import { useMusicEnabled } from "../../lib/useMusicContent";
import { useRichTargetHandler } from "../../lib/useRichTargetHandler";
import { getPlural, getString } from "../../lib/i18n/index";
import { requestTab } from "../../lib/chaptersPanelMemory";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { DescriptionExtras as Extras } from "../../types/video";
import { joinIsolated } from "../../lib/direction";
import { RichValue } from "./LinkedText";

const HASHTAG_LIMIT = 5;

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-chrome-neutral-400">{children}</span>;
}

function SongCard({ song, onPlay }: { song: Extras["music"][number]; onPlay: () => void }) {
  const thumbnail = useProxiedImageUrl(song.thumbnailUrl ?? null);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
      }}
      className="flex min-w-0 items-center gap-3 rounded-xl bg-[var(--desc-raised)] p-2 text-start transition-opacity duration-200 ease-out hover:opacity-90"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest">
        {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover" /> : <Music2 size={18} />}
      </span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate font-medium text-chrome-neutral-100">{song.title}</span>
        <span className="block truncate text-xs text-chrome-neutral-400">
          {joinIsolated([song.artist, song.album])}
        </span>
      </span>
    </button>
  );
}

/** A row that opens one of the watch page's side panels, as Android's Chapters and Transcript rows do. */
function SectionRow({ icon, title, summary, onOpen }: { icon: ReactNode; title: string; summary: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="flex w-full items-center gap-3 rounded-xl bg-[var(--desc-raised)] px-4 py-3 text-start transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="text-chrome-neutral-300">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-chrome-neutral-100">{title}</span>
        <span className="block truncate text-xs text-chrome-neutral-400">{summary}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-chrome-neutral-400 rtl:-scale-x-100" />
    </button>
  );
}

function LinkChip({ link }: { link: Extras["links"][number] }) {
  const openTarget = useRichTargetHandler();
  const icon = useProxiedImageUrl(link.iconUrl ?? null);
  return (
    <button
      dir="auto"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openTarget({ kind: "url", url: link.url });
      }}
      className="inline-flex items-center gap-2 rounded-full border border-chrome-neutral-700 px-3 py-1.5 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-high"
    >
      {icon && <img src={icon} alt="" className="h-4 w-4 shrink-0 object-contain" />}
      {link.title}
    </button>
  );
}

function ChannelCard({ channel, links }: { channel: NonNullable<Extras["channel"]>; links: Extras["links"] }) {
  const openTarget = useRichTargetHandler();
  const avatar = useProxiedImageUrl(channel.avatarUrl ?? null);
  const channelId = channel.channelId;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-[var(--desc-raised)] p-3">
      <button
        type="button"
        disabled={!channelId}
        onClick={(event) => {
          event.stopPropagation();
          if (channelId) openTarget({ kind: "channel", channelId });
        }}
        className="flex min-w-0 items-center gap-3 rounded-xl text-start"
      >
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-container-highest">
          {avatar && <img src={avatar} alt="" className="h-full w-full object-cover" />}
        </span>
        <span className="min-w-0">
          <span dir="auto" className="block truncate text-sm font-semibold text-chrome-neutral-100">{channel.name}</span>
          {channel.subtitle && <span className="block truncate text-xs text-chrome-neutral-400">{channel.subtitle}</span>}
        </span>
      </button>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => <LinkChip key={link.url} link={link} />)}
        </div>
      )}
    </div>
  );
}

interface DescriptionExtrasProps {
  videoId: string;
  extras?: Extras;
  hashtags: string[];
  chapterCount: number;
}

/**
 * The expanded description's sections after its text, in Flow for Android's order: hashtags,
 * credited songs, how the video was made, the chapters and transcript, then the channel.
 */
export function DescriptionExtras({ videoId, extras, hashtags, chapterCount }: DescriptionExtrasProps) {
  const navigate = useNavigate();
  const playSong = usePlayMusicCard();
  const hasCaptions = usePlayerStore((state) => state.captions.length > 0);
  const setChaptersOpen = usePlayerStore((state) => state.setIsChaptersPanelOpen);
  // Credited songs play in the music player, which Show Music hides.
  const songs = useMusicEnabled() ? extras?.music ?? [] : [];
  const disclosure = extras?.disclosure;
  const links = extras?.links ?? [];
  const shownTags = hashtags.slice(0, HASHTAG_LIMIT);

  const openPanel = (tab: "chapters" | "transcript") => {
    requestTab(videoId, tab);
    setChaptersOpen(true);
  };

  return (
    <>
      {shownTags.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {shownTags.map((tag) => (
            <button
              key={tag}
              dir="auto"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/search?q=${encodeURIComponent(tag)}`);
              }}
              className="text-sm font-medium text-[var(--rich-link,var(--color-primary))] hover:underline"
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {songs.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{getString("description_music")}</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {songs.map((song) => (
              <SongCard key={`${song.title}-${song.artist ?? ""}`} song={song} onPlay={() => void playSong(song)} />
            ))}
          </div>
        </div>
      )}

      {disclosure && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{disclosure.title || getString("description_how_this_was_made")}</SectionLabel>
          <div className="flex flex-col gap-1 rounded-xl bg-[var(--desc-raised)] p-4 text-sm">
            {disclosure.header && <span className="font-semibold text-chrome-neutral-100">{disclosure.header}</span>}
            {disclosure.body && <RichValue value={disclosure.body} className="text-chrome-neutral-300" />}
          </div>
        </div>
      )}

      {(chapterCount > 0 || hasCaptions) && (
        <div className="flex flex-col gap-2">
          {chapterCount > 0 && (
            <SectionRow
              icon={<ListVideo className="h-5 w-5" />}
              title={getString("description_chapters")}
              summary={getPlural("description_chapters_count", chapterCount)}
              onOpen={() => openPanel("chapters")}
            />
          )}
          {hasCaptions && (
            <SectionRow
              icon={<ScrollText className="h-5 w-5" />}
              title={getString("description_transcript")}
              summary={getString("description_transcript_summary")}
              onOpen={() => openPanel("transcript")}
            />
          )}
        </div>
      )}

      {extras?.channel ? (
        <ChannelCard channel={extras.channel} links={links} />
      ) : links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => <LinkChip key={link.url} link={link} />)}
        </div>
      ) : null}
    </>
  );
}
