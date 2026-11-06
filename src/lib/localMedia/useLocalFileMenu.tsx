import { FolderMinus, ListPlus, Play } from "lucide-react";

import type { MediaMenuAction } from "../../components/ui/MediaMenu";
import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { useUiStore } from "../../store/useUiStore";
import type { LocalMediaFile } from "../api/localMedia";
import { getString } from "../i18n/index";
import { folderNameOf } from "./filters";
import { queueLocalFile } from "./playback";

/** A library file's menu: queueing first, then what belongs to the file itself. */
export function localFileMenuActions(file: LocalMediaFile): MediaMenuAction[] {
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
  actions.push(
    {
      id: "add-to-queue",
      label: getString("music_add_to_queue"),
      tileLabel: getString("menu_tile_queue"),
      icon: <ListPlus size={16} />,
      group: "quick",
      onSelect: () => queueLocalFile(file, false),
    },
    {
      id: "hide-folder",
      label: getString("local_menu_hide_folder"),
      icon: <FolderMinus size={16} />,
      group: "feed",
      onSelect: () => hideFolder(file.folderPath),
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
