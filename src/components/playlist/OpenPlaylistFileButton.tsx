import { useRef, useState, type ChangeEvent } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { getString } from "../../lib/i18n/index";
import { importPlaylistFileWithToast } from "../../lib/playlistTransfer";
import { Button } from "../ui/Button";

/** Opens a saved Flow playlist, from this app or Flow for Android. */
export function OpenPlaylistFileButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so opening the same file again still fires a change.
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      await importPlaylistFileWithToast(file);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="secondary" className="shrink-0" disabled={importing} onClick={() => inputRef.current?.click()}>
        {importing ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
        {getString("playlist_import")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={(event) => void handleFile(event)}
        className="hidden"
      />
    </>
  );
}
