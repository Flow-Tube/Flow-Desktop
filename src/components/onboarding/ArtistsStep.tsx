import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ArtistCard } from "../music/ArtistCard";
import { SearchInput } from "../ui/SearchInput";
import { ONBOARDING_CARD_GRID } from "./constants";
import { getString } from "../../lib/i18n/index";
import { useArtistPicker } from "../../lib/useArtistPicker";
import { useFavouriteArtistsStore, type FavouriteArtist } from "../../store/useFavouriteArtistsStore";

function ArtistPick({ artist, picked }: { artist: FavouriteArtist; picked: boolean }) {
  const toggle = useFavouriteArtistsStore((state) => state.toggle);
  return (
    <ArtistCard
      fill
      artist={{ id: artist.id, title: artist.name, thumbnail: artist.thumbnailUrl, channelId: artist.id }}
      following={picked}
      onOpen={() => void toggle(artist)}
      onToggleFollow={() => void toggle(artist)}
    />
  );
}

function ArtistSection({ title, artists, picked }: { title: string; artists: FavouriteArtist[]; picked: boolean }) {
  if (artists.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-chrome-neutral-500">{title}</h2>
      <div className={ONBOARDING_CARD_GRID}>
        {artists.map((artist) => (
          <ArtistPick key={artist.id} artist={artist} picked={picked} />
        ))}
      </div>
    </section>
  );
}

/** Pick some artists: they seed the music taste, and only the music taste. */
export function ArtistsStep() {
  const [query, setQuery] = useState("");
  const picked = useFavouriteArtistsStore((state) => state.picked);
  const load = useFavouriteArtistsStore((state) => state.load);
  const { candidates, failed, searching } = useArtistPicker(query);
  const pickedIds = new Set(picked.map((artist) => artist.id));

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex w-full flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
          {getString("onboarding_artists_title")}
        </h1>
        <p className="text-lg text-chrome-neutral-400">{getString("onboarding_artists_subtitle")}</p>
      </div>
      <SearchInput
        pill
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={getString("onboarding_artists_search_placeholder")}
      />
      <ArtistSection title={getString("favourite_artists_picked")} artists={picked} picked />
      {candidates === null ? (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      ) : failed ? (
        <p className="text-sm text-chrome-neutral-400">{getString("onboarding_artists_failed")}</p>
      ) : searching && candidates.length === 0 ? (
        <p className="text-sm text-chrome-neutral-400">{getString("favourite_artists_none")}</p>
      ) : (
        <ArtistSection
          title={getString(searching ? "favourite_artists_results" : "favourite_artists_popular")}
          artists={candidates.filter((artist) => !pickedIds.has(artist.id))}
          picked={false}
        />
      )}
    </div>
  );
}
