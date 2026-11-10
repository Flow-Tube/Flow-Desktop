import { Fragment, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

import { artistsText } from "../../lib/musicFormat";
import type { SongItem } from "../../types/music";

type ArtistLinksProps = {
  artists: SongItem["artists"];
  /** Runs before navigating, e.g. to close the full player. */
  onNavigate?: () => void;
  /** Plain text instead of links, e.g. while rows are being selected. */
  plain?: boolean;
  className?: string;
};

const LINK =
  "rounded-sm transition-colors duration-200 ease-out hover:text-chrome-neutral-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Each credited artist as its own link, so a featured artist opens their own page. */
export function ArtistLinks({ artists, onNavigate, plain = false, className }: ArtistLinksProps) {
  const navigate = useNavigate();
  const list = artists ?? [];

  if (plain || list.length === 0) {
    return <span dir="auto" className={className}>{artistsText(list)}</span>;
  }

  const open = (event: MouseEvent, id: string) => {
    // The link may sit inside a row that plays on click.
    event.stopPropagation();
    onNavigate?.();
    navigate(`/music/artist/${id}`);
  };
  // The row also plays on Enter and Space, and would take the key press from the link.
  const keepKey = (event: KeyboardEvent) => event.stopPropagation();

  return (
    <span className={className}>
      {list.map((artist, index) => (
        <Fragment key={artist.id ?? `${artist.name}-${index}`}>
          {index > 0 && ", "}
          {artist.id ? (
            <button
              type="button"
              dir="auto"
              onClick={(event) => open(event, artist.id as string)}
              onKeyDown={keepKey}
              className={LINK}
            >
              {artist.name}
            </button>
          ) : (
            <span dir="auto">{artist.name}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
