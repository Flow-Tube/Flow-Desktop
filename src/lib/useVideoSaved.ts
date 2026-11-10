import { useEffect, useState } from "react";
import { loadStoredPlaylists, PLAYLIST_LIBRARY_UPDATED_EVENT } from "./playlistLibrary";

/** Whether the video is in Watch Later or one of the viewer's playlists. */
export function useVideoSaved(videoId: string): boolean {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      loadStoredPlaylists()
        .then((playlists) => {
          if (!cancelled) setSaved(playlists.some((playlist) => playlist.tracks.some((track) => track.id === videoId)));
        })
        .catch((error) => console.warn("Failed to read playlists", error));
    };
    read();
    window.addEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(PLAYLIST_LIBRARY_UPDATED_EVENT, read);
    };
  }, [videoId]);

  return saved;
}
