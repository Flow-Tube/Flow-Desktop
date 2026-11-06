import type { ComponentType } from "react";
import { AlertCircle, FolderOpen, Film, Loader2, Music2, SearchX } from "lucide-react";

import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";

function StatePanel({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-col items-center justify-center rounded-3xl border border-dashed border-chrome-neutral-800 bg-surface-container-low p-10 text-center">
      <Icon className="mb-4 h-12 w-12 text-chrome-neutral-700" />
      <h3 className="font-bold text-chrome-neutral-300">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-chrome-neutral-500">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function LocalNoFolders({ onChoose }: { onChoose: () => void }) {
  return (
    <StatePanel
      icon={FolderOpen}
      title={getString("local_media_no_folders_title")}
      body={getString("local_media_no_folders_body")}
    >
      <Button type="button" onClick={onChoose}>
        {getString("local_media_choose_folder")}
      </Button>
    </StatePanel>
  );
}

export function LocalLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <StatePanel icon={AlertCircle} title={getString("local_load_failed")}>
      <Button type="button" variant="tonal" onClick={onRetry}>
        {getString("retry")}
      </Button>
    </StatePanel>
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
    <StatePanel
      icon={isVideos ? Film : Music2}
      title={scanning ? getString("local_media_scanning") : getString(isVideos ? "local_media_empty_videos" : "local_media_empty_music")}
      body={scanning ? undefined : getString("local_media_empty_body")}
    />
  );
}

export function LocalNoMatches({ onClear }: { onClear?: () => void }) {
  return (
    <StatePanel icon={SearchX} title={getString("local_media_no_matches")}>
      {onClear && (
        <Button type="button" variant="tonal" onClick={onClear}>
          {getString("local_media_clear_filters")}
        </Button>
      )}
    </StatePanel>
  );
}
