import { EmptyState } from "../ui/EmptyState";
import { AlertCircle, FolderOpen, Film, Loader2, Music2, SearchX } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";


export function LocalNoFolders({ onChoose }: { onChoose: () => void }) {
  return (
    <EmptyState
      icon={FolderOpen}
      title={getString("local_media_no_folders_title")}
      body={getString("local_media_no_folders_body")}
    >
      <Button type="button" onClick={onChoose}>
        {getString("local_media_choose_folder")}
      </Button>
    </EmptyState>
  );
}

export function LocalLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState icon={AlertCircle} title={getString("local_load_failed")}>
      <Button type="button" variant="tonal" onClick={onRetry}>
        {getString("retry")}
      </Button>
    </EmptyState>
  );
}

export function LocalLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <Loader2 className="h-9 w-9 animate-spin text-primary" />
    </div>
  );
}

export function LocalEmpty({ isVideos, scanning }: { isVideos: boolean; scanning: boolean }) {
  return (
    <EmptyState
      icon={isVideos ? Film : Music2}
      title={scanning ? getString("local_media_scanning") : getString(isVideos ? "local_media_empty_videos" : "local_media_empty_music")}
      body={scanning ? undefined : getString("local_media_empty_body")}
    />
  );
}

export function LocalNoMatches({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState icon={SearchX} title={getString("local_media_no_matches")}>
      {onClear && (
        <Button type="button" variant="tonal" onClick={onClear}>
          {getString("local_media_clear_filters")}
        </Button>
      )}
    </EmptyState>
  );
}
