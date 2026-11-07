import { useState } from "react";
import { Download, ListChecks, ListMusic, ListPlus, Save, Trash2 } from "lucide-react";
import { confirmAction } from "../../lib/dialogs";
import { downloadManyWithToast } from "../../lib/downloadMany";
import { getPlural, getString } from "../../lib/i18n/index";
import {
  LIKES_SORT_ORDERS,
  likedDownloadTargets,
  likedPlaylistFile,
  likedSongs,
  likedVideos,
} from "../../lib/likedItems";
import { playlistSortLabel, type PlaylistSortOrder } from "../../lib/playlistSort";
import { savePlaylistFileWithToast } from "../../lib/playlistTransfer";
import { useLikesStore, type LikedItem } from "../../store/useLikesStore";
import { useMusicPlayerStore } from "../../store/useMusicPlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { AddAllToPlaylistDialog } from "../playlist/AddAllToPlaylistDialog";
import { addVideosToQueueWithToast } from "../playlist/PlaylistSelectionActions";
import { IconButton } from "../ui/IconButton";
import { Select } from "../ui/Select";
import { SelectionBar } from "../ui/SelectionBar";

interface LikesToolbarProps {
  /** What the page shows now, filtered and sorted; every action works from it. */
  items: LikedItem[];
  sortOrder: PlaylistSortOrder;
  onSortChange: (order: PlaylistSortOrder) => void;
  selecting: boolean;
  selected: LikedItem[];
  allSelected: boolean;
  onStartSelecting: () => void;
  onToggleAll: () => void;
  onDoneSelecting: () => void;
}

export function LikesToolbar({
  items,
  sortOrder,
  onSortChange,
  selecting,
  selected,
  allSelected,
  onStartSelecting,
  onToggleAll,
  onDoneSelecting,
}: LikesToolbarProps) {
  const [adding, setAdding] = useState(false);
  const showToast = useUiStore((state) => state.showToast);
  const removeMany = useLikesStore((state) => state.removeMany);
  const restore = useLikesStore((state) => state.restore);
  const addSongToQueue = useMusicPlayerStore((state) => state.addToQueue);
  const empty = items.length === 0;

  const downloadAll = async () => {
    const targets = likedDownloadTargets(items);
    const confirmed = await confirmAction({
      title: getString("likes_download_all"),
      message: getPlural("likes_download_all_confirm", targets.length),
      confirmLabel: getString("download"),
    });
    if (confirmed) await downloadManyWithToast(targets);
  };

  const saveAsFile = () => {
    const file = likedPlaylistFile(items, getString("likes_title"));
    if (file) void savePlaylistFileWithToast(file);
  };

  const removeSelected = async () => {
    const confirmed = await confirmAction({
      title: getPlural("likes_remove_selected_title", selected.length),
      message: getString("likes_remove_selected_text"),
      confirmLabel: getString("remove"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const removed = await removeMany(selected);
      onDoneSelecting();
      showToast({
        variant: "success",
        message: getPlural("likes_removed", removed.length),
        actions: [{
          label: getString("undo"),
          onSelect: () => {
            void restore(removed).catch((error) => {
              console.error("Failed to restore likes", error);
              showToast({ variant: "error", message: getString("toast_action_failed") });
            });
          },
        }],
      });
    } catch (error) {
      console.error("Failed to remove likes", error);
      showToast({ variant: "error", message: getString("likes_remove_failed") });
    }
  };

  const queueSelected = () => {
    const songs = likedSongs(selected);
    const videos = likedVideos(selected);
    songs.forEach(addSongToQueue);
    if (videos.length > 0) addVideosToQueueWithToast(videos);
    else showToast({ variant: "success", message: getPlural("likes_songs_queued", songs.length) });
    onDoneSelecting();
  };

  const onlyVideos = selected.every((item) => item.kind === "video");

  if (selecting) {
    return (
      <div className="flex items-center md:ms-auto">
        <SelectionBar
          summary={getPlural("playlist_selected_count", selected.length)}
          hasSelection={selected.length > 0}
          allSelected={allSelected}
          onToggleAll={onToggleAll}
          onDone={onDoneSelecting}
          actions={[
            { key: "queue", icon: <ListPlus size={16} />, label: getString("music_add_to_queue"), onClick: queueSelected },
            ...(onlyVideos
              ? [{ key: "add", icon: <ListMusic size={16} />, label: getString("video_add_to_playlist"), onClick: () => setAdding(true) }]
              : []),
            {
              key: "download",
              icon: <Download size={16} />,
              label: getString("download"),
              onClick: () => {
                void downloadManyWithToast(likedDownloadTargets(selected));
                onDoneSelecting();
              },
            },
            { key: "remove", icon: <Trash2 size={16} />, label: getString("remove"), destructive: true, onClick: () => void removeSelected() },
          ]}
        />
        {adding && (
          <AddAllToPlaylistDialog
            title={getPlural("playlist_add_selected_title", selected.length)}
            loadVideos={() => Promise.resolve(likedVideos(selected))}
            onClose={() => {
              setAdding(false);
              onDoneSelecting();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 md:ms-auto">
      <Select
        value={sortOrder}
        onChange={(value) => onSortChange(value as PlaylistSortOrder)}
        options={LIKES_SORT_ORDERS.map((order) => ({ value: order, label: playlistSortLabel(order) }))}
        className="w-56"
      />
      <div className="ms-auto flex items-center gap-2">
        <IconButton aria-label={getString("playlist_select")} title={getString("playlist_select")} disabled={empty} onClick={onStartSelecting}>
          <ListChecks size={18} />
        </IconButton>
        <IconButton aria-label={getString("likes_download_all")} title={getString("likes_download_all")} disabled={empty} onClick={() => void downloadAll()}>
          <Download size={18} />
        </IconButton>
        <IconButton aria-label={getString("playlist_export")} title={getString("playlist_export")} disabled={empty} onClick={saveAsFile}>
          <Save size={18} />
        </IconButton>
      </div>
    </div>
  );
}
