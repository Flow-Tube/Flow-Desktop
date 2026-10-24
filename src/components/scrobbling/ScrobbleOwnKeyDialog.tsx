import { useState } from "react";
import { TextInput } from "../ui/TextInput";
import { ScrobbleDialog } from "./ScrobbleDialog";
import { getString } from "../../lib/i18n/index";

interface ScrobbleOwnKeyDialogProps {
  onSave: (apiKey: string, secret: string) => Promise<boolean>;
  onClose: () => void;
}

const fieldLabel = "block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500";

// The stored key is never read back into the page; saving replaces it.
export function ScrobbleOwnKeyDialog({ onSave, onClose }: ScrobbleOwnKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async () => {
    setWorking(true);
    const saved = await onSave(apiKey, secret);
    setWorking(false);
    if (saved) onClose();
    else setFailed(true);
  };

  return (
    <ScrobbleDialog
      title={getString("scrobbling_own_key_dialog_title")}
      submitLabel={getString("save")}
      submitDisabled={working || !apiKey.trim() || !secret.trim()}
      onSubmit={() => void save()}
      onCancel={onClose}
    >
      <p className="text-sm text-chrome-neutral-400">{getString("scrobbling_own_key_dialog_body")}</p>
      <label className="block space-y-2">
        <span className={fieldLabel}>{getString("scrobbling_api_key")}</span>
        <TextInput value={apiKey} onChange={setApiKey} disabled={working} autoComplete="off" spellCheck={false} className="w-full font-mono" autoFocus />
      </label>
      <label className="block space-y-2">
        <span className={fieldLabel}>{getString("scrobbling_secret")}</span>
        <TextInput type="password" value={secret} onChange={setSecret} disabled={working} autoComplete="off" className="w-full font-mono" />
      </label>
      {failed && <p className="text-xs text-[var(--color-error)]" role="alert">{getString("scrobbling_own_key_failed")}</p>}
    </ScrobbleDialog>
  );
}
