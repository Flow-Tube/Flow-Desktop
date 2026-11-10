import { describe, expect, it, vi } from "vitest";

import type { SongItem } from "../../types/music";
import { useTrackNavActions } from "./useTrackNavActions";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

function makeTrack(artists: { name: string; id: string | null }[], albumId: string | null = null): SongItem {
  return {
    id: "song-1",
    title: "Test Track",
    artists,
    album: albumId ? { id: albumId, name: "Test Album" } : null,
    duration: 180,
    musicVideoType: null,
    thumbnail: "https://example.com/thumb.jpg",
    explicit: false,
    videoId: "song-1",
    playlistId: null,
    params: null,
  };
}

describe("useTrackNavActions", () => {
  it("returns empty array when track is null", () => {
    const actions = useTrackNavActions(null);
    expect(actions).toEqual([]);
  });

  it("creates a single view-artist action when there is only one artist with an id", () => {
    mockNavigate.mockClear();
    const track = makeTrack([{ name: "DIVINE", id: "UC-divine" }]);
    const onNavigate = vi.fn();
    const actions = useTrackNavActions(track, { onNavigate });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("view-artist");
    expect(actions[0]?.label).toBe("View artist");

    actions[0]?.onSelect();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-divine");
  });

  it("creates distinct navigation actions for each artist in a multi-artist track", () => {
    mockNavigate.mockClear();
    const track = makeTrack([
      { name: "DIVINE", id: "UC-divine" },
      { name: "Jonita Gandhi", id: "UC-jonita" },
    ]);
    const onNavigate = vi.fn();
    const actions = useTrackNavActions(track, { onNavigate });

    const artistActions = actions.filter((a) => a.id.startsWith("view-artist"));
    expect(artistActions).toHaveLength(2);

    expect(artistActions[0]?.id).toBe("view-artist-UC-divine");
    expect(artistActions[0]?.label).toContain("DIVINE");

    expect(artistActions[1]?.id).toBe("view-artist-UC-jonita");
    expect(artistActions[1]?.label).toContain("Jonita Gandhi");

    // Selecting secondary artist navigates to secondary artist, NOT primary artist
    artistActions[1]?.onSelect();
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-jonita");

    // Selecting primary artist navigates to primary artist
    artistActions[0]?.onSelect();
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-divine");
  });

  it("handles tracks with 3+ artists and skips artists without IDs", () => {
    mockNavigate.mockClear();
    const track = makeTrack([
      { name: "Shashwat Sachdev", id: "UC-shashwat" },
      { name: "Hanumankind", id: "UC-hanumankind" },
      { name: "Jasmine Sandlas", id: "UC-jasmine" },
      { name: "Sudhir Yaduvanshi", id: null },
    ]);
    const actions = useTrackNavActions(track);
    const artistActions = actions.filter((a) => a.id.startsWith("view-artist"));

    expect(artistActions).toHaveLength(3);
    expect(artistActions.map((a) => a.id)).toEqual([
      "view-artist-UC-shashwat",
      "view-artist-UC-hanumankind",
      "view-artist-UC-jasmine",
    ]);

    artistActions[2]?.onSelect();
    expect(mockNavigate).toHaveBeenCalledWith("/music/artist/UC-jasmine");
  });

  it("adds view-album when album id is present", () => {
    mockNavigate.mockClear();
    const track = makeTrack([{ name: "DIVINE", id: "UC-divine" }], "MPREb_album123");
    const actions = useTrackNavActions(track);

    const albumAction = actions.find((a) => a.id === "view-album");
    expect(albumAction).toBeDefined();

    albumAction?.onSelect();
    expect(mockNavigate).toHaveBeenCalledWith("/music/album/MPREb_album123");
  });
});
