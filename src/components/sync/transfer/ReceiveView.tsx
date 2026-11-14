import { useCallback, useState } from "react";
import { Camera, ClipboardPaste, QrCode } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { looksLikeAddress } from "../../../lib/syncErrors";
import { useSyncStore } from "../../../store/useSyncStore";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { CameraScanner } from "../CameraScanner";
import { Spinner } from "../SyncParts";

const ICON = "h-5 w-5";

/** The ways to receive from a nearby device: scan its code, paste it, or show one for it to scan. */
export function ReceiveView() {
  const { hostReceive, join, busy } = useSyncStore();
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const onConnect = () => {
    const text = paste.trim();
    if (/^\d{4,8}$/.test(text)) return setPasteError(getString("sync_paste_is_sas"));
    if (looksLikeAddress(text)) return setPasteError(getString("sync_paste_is_address"));
    if (!text.startsWith("{")) return setPasteError(getString("sync_paste_invalid"));
    setPasteError(null);
    void join(text);
  };

  const onScanned = useCallback(
    (text: string) => {
      setScanning(false);
      void join(text);
    },
    [join],
  );

  return (
    <div className="flex flex-col gap-6">
      {scanning && <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />}
      <SettingsGroup>
        <SettingItem
          icon={<Camera className={ICON} />}
          title={getString("sync_scan_camera")}
          description={getString("sync_scan_desc")}
          disabled={busy || scanning}
          onSelect={() => setScanning(true)}
        />
        <SettingItem
          icon={<ClipboardPaste className={ICON} />}
          title={getString("sync_paste_row")}
          description={pasteError ?? getString("sync_paste_desc")}
          titleClassName={pasteError ? "text-chrome-red-400" : undefined}
        >
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onConnect();
            }}
          >
            <TextInput
              value={paste}
              onChange={(value) => {
                setPaste(value);
                if (pasteError) setPasteError(null);
              }}
              placeholder={getString("sync_paste_placeholder")}
              aria-label={getString("sync_paste_row")}
              spellCheck={false}
              className="w-56"
            />
            <Button type="submit" size="sm" disabled={busy || !paste.trim()}>
              {busy ? <Spinner className="h-4 w-4" /> : null}
              {getString("sync_connect")}
            </Button>
          </form>
        </SettingItem>
        <SettingItem
          icon={<QrCode className={ICON} />}
          title={getString("sync_show_qr_button")}
          description={getString("sync_show_qr_hint")}
          disabled={busy}
          onSelect={() => void hostReceive()}
        />
      </SettingsGroup>
    </div>
  );
}
