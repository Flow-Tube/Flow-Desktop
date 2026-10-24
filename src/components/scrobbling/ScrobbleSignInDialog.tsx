import { useState } from "react";
import { TextInput } from "../ui/TextInput";
import { ScrobbleDialog } from "./ScrobbleDialog";
import { getString } from "../../lib/i18n/index";

interface ScrobbleSignInDialogProps {
  serviceName: string;
  /** ListenBrainz signs in with a user token instead of a user name and password. */
  usesToken: boolean;
  /** Resolves to null on success, or the message to show. */
  onSubmit: (userName: string, secret: string) => Promise<string | null>;
  onClose: () => void;
}

const fieldLabel = "block text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500";

export function ScrobbleSignInDialog({ serviceName, usesToken, onSubmit, onClose }: ScrobbleSignInDialogProps) {
  const [userName, setUserName] = useState("");
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setWorking(true);
    setError(null);
    const failure = await onSubmit(userName, secret);
    setWorking(false);
    if (failure) {
      setError(failure);
      return;
    }
    setSecret("");
    onClose();
  };

  return (
    <ScrobbleDialog
      title={getString("scrobbling_sign_in_title", serviceName)}
      submitLabel={getString("scrobbling_sign_in")}
      submitDisabled={working || !secret.trim() || (!usesToken && !userName.trim())}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {!usesToken && (
        <label className="block space-y-2">
          <span className={fieldLabel}>{getString("scrobbling_user_name")}</span>
          <TextInput value={userName} onChange={setUserName} disabled={working} autoComplete="username" className="w-full" autoFocus />
        </label>
      )}
      <label className="block space-y-2">
        <span className={fieldLabel}>{getString(usesToken ? "scrobbling_token" : "scrobbling_password")}</span>
        <TextInput
          type="password"
          value={secret}
          onChange={setSecret}
          disabled={working}
          autoComplete={usesToken ? "off" : "current-password"}
          className="w-full"
          autoFocus={usesToken}
        />
      </label>
      <p className={`text-xs ${error ? "text-[var(--color-error)]" : "text-chrome-neutral-400"}`} role={error ? "alert" : undefined}>
        {error ?? getString(usesToken ? "scrobbling_token_note" : "scrobbling_password_note")}
      </p>
    </ScrobbleDialog>
  );
}
