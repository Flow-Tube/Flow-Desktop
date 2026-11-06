import { useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

import type { LocalMediaFile } from "../../lib/api/localMedia";
import { getString } from "../../lib/i18n/index";
import { localFileMenuActions } from "../../lib/localMedia/useLocalFileMenu";
import type { MenuAnchor } from "../ui/AnchoredPortalMenu";
import { MediaMenu } from "../ui/MediaMenu";

export function LocalFileMenuButton({ file }: { file: LocalMediaFile }) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 8, flipBottom: rect.top - 8, right: rect.right });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
        aria-label={getString("local_file_options")}
        className="shrink-0 rounded-full p-1.5 text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MoreVertical size={18} />
      </button>
      {anchor && (
        <MediaMenu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          actions={localFileMenuActions(file)}
          header={{ title: file.title, subtitle: file.fileName }}
        />
      )}
    </>
  );
}
