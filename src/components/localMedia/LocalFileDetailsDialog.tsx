import type { LocalMediaFile } from "../../lib/api/localMedia";
import { formatBytes, formatDuration } from "../../lib/downloadOptions";
import { getString } from "../../lib/i18n/index";
import { DetailRows } from "../ui/DetailRows";
import { InfoDialog } from "../ui/InfoDialog";

/** The rows a file has anything to say for, in reading order. */
export function localFileDetails(file: LocalMediaFile): { label: string; value: string; technical?: boolean }[] {
  const rows: { label: string; value: string | null | false; technical?: boolean }[] = [
    { label: getString("local_detail_title"), value: file.title },
    { label: getString("local_detail_file"), value: file.fileName },
    { label: getString("local_detail_folder"), value: file.folderPath },
    { label: getString("local_detail_artist"), value: file.artist },
    { label: getString("local_detail_album"), value: file.album },
    { label: getString("local_detail_length"), value: file.durationMs > 0 && formatDuration(file.durationMs / 1000) },
    { label: getString("local_detail_size"), value: formatBytes(file.sizeBytes) },
    {
      label: getString("local_detail_resolution"),
      value: file.width > 0 && file.height > 0 && getString("local_detail_resolution_value", file.width, file.height),
    },
    {
      label: getString("local_detail_frame_rate"),
      value: file.frameRate !== null && getString("local_detail_fps", Number(file.frameRate.toFixed(2))),
    },
    { label: getString("local_detail_video_codec"), value: file.videoCodec, technical: true },
    { label: getString("local_detail_audio_codec"), value: file.audioCodec, technical: true },
    {
      label: getString("local_detail_bitrate"),
      value: file.bitrateKbps !== null && getString("local_detail_kbps", file.bitrateKbps),
    },
    {
      label: getString("local_detail_added"),
      value: file.addedMs > 0 && new Date(file.addedMs).toLocaleDateString(),
    },
  ];
  return rows.flatMap((row) => (row.value ? [{ label: row.label, value: row.value, technical: row.technical }] : []));
}

export function LocalFileDetailsDialog({ file, onClose }: { file: LocalMediaFile; onClose: () => void }) {
  return (
    <InfoDialog title={getString("local_menu_details")} closeLabel={getString("close")} onClose={onClose}>
      <DetailRows rows={localFileDetails(file).map((row) => ({ label: row.label, value: row.value, mono: row.technical }))} />
    </InfoDialog>
  );
}
