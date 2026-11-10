import { Captions, FolderMinus, Info, ListPlus, Play, Trash2 } from "lucide-react";

import type { MediaMenuAction } from "../../components/ui/MediaMenu";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { pickLocalSubtitle, type LocalMediaFile } from "../api/localMedia";
import { confirmAction } from "../dialogs";
import { getString } from "../i18n/index";
import { folderNameOf } from "./filters";
import { queueLocalFile, stopPlayingLocalFile } from "./playback";

interface LocalMenuHandlers {
  onDetails: () => void;
  navigate: (path: string) => void;
}

/** A library file's menu: queueing first, then what belongs to the file itself. */
export function localFileMenuActions(file: LocalMediaFile, handlers: LocalMenuHandlers): MediaMenuAction[] {
  const actions: MediaMenuAction[] = [];
  if (file.kind === "audio") {
    actions.push({
      id: "play-next",
      label: getString("music_play_next"),
      tileLabel: getString("menu_tile_play_next"),
      icon: <Play size={16} />,
      group: "quick",
      onSelect: () => queueLocalFile(file, true),
    });
  }
  actions.push({
    id: "add-to-queue",
    label: getString("music_add_to_queue"),
    tileLabel: getString("menu_tile_queue"),
    icon: <ListPlus size={16} />,
    group: "quick",
    onSelect: () => queueLocalFile(file, false),
  });
  actions.push({
    id: "details",
    label: getString("local_menu_details"),
    icon: <Info size={16} />,
    group: "library",
    onSelect: handlers.onDetails,
  });
  if (file.kind === "video") {
    actions.push({
      id: "add-subtitle",
      label: getString("local_menu_add_subtitle"),
      icon: <Captions size={16} />,
      group: "library",
      onSelect: () => addSubtitle(file),
    });
  }
  actions.push(
    {
      id: "hide-folder",
      label: getString("local_menu_hide_folder"),
      icon: <FolderMinus size={16} />,
      group: "feed",
      onSelect: () => hideFolder(file.folderPath),
    },
    {
      id: "trash",
      label: getString("local_menu_trash"),
      icon: <Trash2 size={16} />,
      group: "feed",
      danger: true,
      onSelect: () => moveToTrash(file, handlers.navigate),
    },
  );
  return actions;
}

function hideFolder(path: string) {
  const toast = useUiStore.getState().showToast;
  const library = useLocalMediaStore.getState();
  // Hiding a folder you chose would empty the library of it; Settings is where it's removed.
  if (library.folders.some((folder) => folder.role === "include" && folder.path === path)) {
    toast({ message: getString("local_folder_hide_chosen") });
    return;
  }
  void library
    .excludeFolder(path)
    .then(() => toast({ message: getString("local_folder_hidden", folderNameOf(path)) }))
    .catch(() => toast({ variant: "error", message: getString("local_folder_hide_failed") }));
}

async function addSubtitle(file: LocalMediaFile) {
  const toast = useUiStore.getState().showToast;
  try {
    const track = await pickLocalSubtitle(
      file.id,
      getString("local_subtitle_pick_title"),
      getString("local_subtitle_filter_name"),
    );
    if (!track) return;
    const player = usePlayerStore.getState();
    if (player.currentVideo?.id === file.id) player.setCaptions([...player.captions, track]);
    toast({ message: getString("local_subtitle_added", track.label) });
  } catch {
    toast({ variant: "error", message: getString("local_subtitle_failed") });
  }
}

async function moveToTrash(file: LocalMediaFile, navigate: (path: string) => void) {
  const confirmed = await confirmAction({
    title: getString("local_trash_confirm_title"),
    message: getString("local_trash_confirm_body"),
    item: { title: file.title, subtitle: file.fileName },
    confirmLabel: getString("local_menu_trash"),
    destructive: true,
  });
  if (!confirmed) return;
  const toast = useUiStore.getState().showToast;
  try {
    await useLocalMediaStore.getState().trashFile(file.id);
    stopPlayingLocalFile(file.id, navigate);
    toast({ message: getString("local_trashed", file.title) });
  } catch {
    toast({ variant: "error", message: getString("local_trash_failed") });
  }
}
