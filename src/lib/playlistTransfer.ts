import { getPlural, getString } from "./i18n/index";
import {
  decodePlaylistFile,
  encodePlaylistFile,
  fileEntryToSong,
  fileEntryToVideo,
  PLAYLIST_FILE_MAX_BYTES,
  playlistFileName,
  type PlaylistFileContents,
} from "./playlistFile";
import { importStoredPlaylist } from "./playlistLibrary";
import { saveJsonFile } from "./saveJsonFile";
import { albumDetailPath, useAlbumLibraryStore } from "../store/useAlbumLibraryStore";
import { useUiStore } from "../store/useUiStore";

/** Asks where to save the playlist and writes it there; cancelling says nothing. */
export async function savePlaylistFileWithToast(contents: PlaylistFileContents): Promise<void> {
  const { showToast } = useUiStore.getState();
  try {
    const saved = await saveJsonFile(
      getString("playlist_export"),
      playlistFileName(contents.name),
      encodePlaylistFile(contents, Date.now()),
    );
    if (saved) showToast({ variant: "success", message: getString("playlist_exported") });
  } catch (error) {
    console.error("Failed to save a playlist file", error);
    showToast({ variant: "error", message: getString("playlist_export_failed") });
  }
}

/** Reads the rest of a list first. A failed read saves nothing rather than part of the list. */
export async function savePlaylistWhenLoaded(load: () => Promise<PlaylistFileContents>): Promise<void> {
  let contents: PlaylistFileContents;
  try {
    contents = await load();
  } catch (error) {
    console.error("Failed to read a playlist for saving", error);
    useUiStore.getState().showToast({ variant: "error", message: getString("playlist_export_failed") });
    return;
  }
  await savePlaylistFileWithToast(contents);
}

const fileNameWithoutExtension = (name: string) => name.replace(/\.[^.]+$/, "");

/** Adds the playlist in `file` as a new one of your own, in the Music library when it's music. */
export async function importPlaylistFileWithToast(file: File): Promise<void> {
  const { showToast } = useUiStore.getState();
  const fail = (key: Parameters<typeof getString>[0]) => showToast({ variant: "error", message: getString(key) });

  if (file.size > PLAYLIST_FILE_MAX_BYTES) return fail("playlist_import_unreadable");
  let raw: string;
  try {
    raw = await file.text();
  } catch {
    return fail("playlist_import_unreadable");
  }

  const read = decodePlaylistFile(raw);
  if (read.kind === "notAPlaylist") return fail("playlist_import_not_a_playlist");
  if (read.kind === "tooNew") return fail("playlist_import_too_new");
  const { videos, isMusic, description } = read.file;
  if (videos.length === 0) return fail("playlist_import_empty");
  const name = read.file.name.trim() || fileNameWithoutExtension(file.name);

  try {
    if (isMusic) {
      const library = useAlbumLibraryStore.getState();
      if (!library.loaded) await library.load();
      const album = await useAlbumLibraryStore.getState().importAlbum(name, description, videos.map(fileEntryToSong));
      showToast({
        variant: "success",
        message: getPlural("music_playlist_imported", videos.length, name),
        actions: [{ label: getString("toast_view"), to: albumDetailPath(album) }],
      });
    } else {
      const playlist = await importStoredPlaylist(name, description, videos.map(fileEntryToVideo));
      showToast({
        variant: "success",
        message: getPlural("playlist_imported", videos.length, name),
        actions: [{ label: getString("toast_view"), to: `/playlist/${playlist.id}` }],
      });
    }
  } catch (error) {
    console.error("Failed to import a playlist file", error);
    fail("playlist_import_failed");
  }
}
