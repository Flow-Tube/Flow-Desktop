import { useState } from "react";
import { Download, ListMusic, ListPlus, Trash2 } from "lucide-react";
import { confirmAction } from "../../lib/dialogs";
import { downloadManyWithToast } from "../../lib/downloadMany";
import { getPlural, getString } from "../../lib/i18n/index";
import {
  getStoredPlaylistById,
  isProtectedPlaylistId,
  removeVideosFromStoredPlaylist,
  restoreStoredPlaylistTracks,
} from "../../lib/playlistLibrary";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import type { VideoSummary } from "../../types/video";
import { SelectionBar } from "../ui/SelectionBar";
import { AddAllToPlaylistDialog } from "./AddAllToPlaylistDialog";

/** Queues `videos` and says how many went in. */
export function addVideosToQueueWithToast(videos: VideoSummary[]) {
  const { addToQueue } = usePlayerStore.getState();
  const added = videos.filter((video) => addToQueue(video) === "added").length;
  useUiStore.getState().showToast({
    variant: added > 0 ? "success" : "info",
    message: added > 0 ? getPlural("playlist_added_to_queue", added) : getString("playlist_already_in_queue"),
  });
}

interface PlaylistSelectionActionsProps {
  playlistId: string;
  /** The playlist is yours to change, so Remove is offered. */
  editable: boolean;
  selected: VideoSummary[];
  allSelected: boolean;
  onToggleAll: () => void;
  onDone: () => void;
  /** The videos the playlist holds now, after a removal or its undo. */
  onTracksChanged: (videos: VideoSummary[]) => void;
}

export function PlaylistSelectionActions({
  playlistId,
  editable,
  selected,
  allSelected,
  onToggleAll,
  onDone,
  onTracksChanged,
}: PlaylistSelectionActionsProps) {
  const [adding, setAdding] = useState(false);
  const showToast = useUiStore((state) => state.showToast);
  const count = selected.length;

  const reload = async () => {
    onTracksChanged((await getStoredPlaylistById(playlistId))?.tracks ?? []);
  };

  const remove = async () => {
    const confirmed = await confirmAction({
      title: getPlural("playlist_remove_selected_title", count),
      message: getString(isProtectedPlaylistId(playlistId) ? "playlist_remove_selected_watch_later_text" : "playlist_remove_selected_text"),
      confirmLabel: getString("remove"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const removed = await removeVideosFromStoredPlaylist(playlistId, new Set(selected.map((video) => video.id)));
      await reload();
      onDone();
      showToast({
        variant: "success",
        message: getPlural("playlist_videos_removed", removed.length),
        actions: [{
          label: getString("undo"),
          onSelect: () => {
            void restoreStoredPlaylistTracks(playlistId, removed)
              .then(reload)
              .catch((error) => {
                console.error("Failed to restore removed videos", error);
                showToast({ variant: "error", message: getString("toast_action_failed") });
              });
          },
        }],
      });
    } catch (error) {
      console.error("Failed to remove videos from the playlist", error);
      showToast({ variant: "error", message: getString("playlist_could_not_update_library") });
    }
  };

  return (
    <>
      <SelectionBar
        summary={getPlural("playlist_selected_count", count)}
        hasSelection={count > 0}
        allSelected={allSelected}
        onToggleAll={onToggleAll}
        onDone={onDone}
        actions={[
          {
            key: "queue",
            icon: <ListPlus size={16} />,
            label: getString("music_add_to_queue"),
            onClick: () => {
              addVideosToQueueWithToast(selected);
              onDone();
            },
          },
          {
            key: "add",
            icon: <ListMusic size={16} />,
            label: getString("video_add_to_playlist"),
            onClick: () => setAdding(true),
          },
          {
            key: "download",
            icon: <Download size={16} />,
            label: getString("download"),
            onClick: () => {
              void downloadManyWithToast(selected.map((video) => ({ kind: "video", video })));
              onDone();
            },
          },
          ...(editable
            ? [{
                key: "remove",
                icon: <Trash2 size={16} />,
                label: getString("remove"),
                destructive: true,
                onClick: () => void remove(),
              }]
            : []),
        ]}
      />
      {adding && (
        <AddAllToPlaylistDialog
          title={getPlural("playlist_add_selected_title", count)}
          excludePlaylistId={playlistId}
          loadVideos={() => Promise.resolve(selected)}
          onClose={() => {
            setAdding(false);
            onDone();
          }}
        />
      )}
    </>
  );
}
