import { Folder } from "lucide-react";

import { formatBytes } from "../../lib/downloadOptions";
import { getPlural } from "../../lib/i18n/index";
import type { LocalFolderGroup } from "../../lib/localMedia/filters";

export function LocalFolderList({
  folders,
  isVideos,
  onOpen,
}: {
  folders: LocalFolderGroup[];
  isVideos: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {folders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          onClick={() => onOpen(folder.path)}
          title={folder.path}
          className="flex items-center gap-3 rounded-xl bg-surface-row px-4 py-3 text-start transition-colors duration-200 ease-out hover:bg-surface-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Folder className="h-5 w-5 shrink-0 text-chrome-neutral-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-chrome-neutral-100">{folder.name}</span>
            <span className="block truncate text-xs tabular-nums text-chrome-neutral-400">
              {getPlural(isVideos ? "local_videos_count" : "local_songs_count", folder.files.length)}
              {" · "}
              {formatBytes(folder.sizeBytes)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
