import { useCallback, useState, type ReactNode } from "react";
import { Camera } from "lucide-react";

import type { FolderAccess } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { CameraScanner } from "../CameraScanner";

/**
 * Pastes or scans another device's code and answers it, through `folder`'s mailbox when given;
 * `children` adds more actions.
 */
export function CodeEntry({ folder, children }: { folder?: FolderAccess; children?: ReactNode }) {
  const { enterCode, busy } = useLinkedDevicesStore();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const onScanned = useCallback(
    (text: string) => {
      setScanning(false);
      void enterCode(text, folder);
    },
    [enterCode, folder],
  );
  if (scanning) return <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />;
  return (
    <>
      <TextInput value={code} onChange={setCode} placeholder={getString("linked_join_placeholder")} spellCheck={false} />
      <div className="mt-auto flex flex-wrap gap-2">
        <Button disabled={busy || !code.trim()} onClick={() => void enterCode(code, folder)}>
          {getString("linked_join")}
        </Button>
        <Button variant="tonal" disabled={busy} onClick={() => setScanning(true)}>
          <Camera className="h-4 w-4" /> {getString("linked_scan")}
        </Button>
        {children}
      </div>
    </>
  );
}
