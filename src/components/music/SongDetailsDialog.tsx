import { Loader2 } from "lucide-react";

import { copyText } from "../../lib/clipboard";
import { getString } from "../../lib/i18n/index";
import { useSongDetails } from "../../lib/useSongDetails";
import { useSongDetailsStore } from "../../store/useSongDetailsStore";
import { useUiStore } from "../../store/useUiStore";
import { DetailRows } from "../ui/DetailRows";
import { InfoDialog } from "../ui/InfoDialog";

/** A song's details, each line copied by clicking it. */
export function SongDetailsDialog() {
  const song = useSongDetailsStore((state) => state.song);
  const close = useSongDetailsStore((state) => state.close);
  const showToast = useUiStore((state) => state.showToast);
  const { lines, loading } = useSongDetails(song);

  if (!song) return null;

  const copy = async (value: string) => {
    const copied = await copyText(value);
    showToast(copied
      ? { variant: "success", message: getString("selection_copied") }
      : { variant: "error", message: getString("selection_copy_failed") });
  };

  return (
    <InfoDialog
      title={getString("music_details")}
      closeLabel={getString("close")}
      onClose={close}
      titleAccessory={loading ? <Loader2 className="h-4 w-4 animate-spin text-chrome-neutral-500" /> : null}
    >
      <DetailRows
        rows={lines}
        onRowClick={(line) => void copy(line.value)}
        rowLabel={(line) => getString("music_details_copy", line.label)}
      />
    </InfoDialog>
  );
}
