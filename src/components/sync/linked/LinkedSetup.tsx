import { useCallback, useState } from "react";
import { Camera } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { CameraScanner } from "../CameraScanner";
import { Card, Field } from "./Card";

function CreateGroup() {
  const { create, busy } = useLinkedDevicesStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <Card title={getString("linked_setup_title")} subtitle={getString("linked_setup_subtitle")} className="col-span-12 lg:col-span-6">
      <Field label={getString("linked_server_url")}>
        <TextInput value={url} onChange={setUrl} placeholder={getString("linked_server_url_placeholder")} spellCheck={false} />
      </Field>
      <Field label={getString("linked_admin_token")} hint={getString("linked_admin_token_hint")}>
        <TextInput type="password" value={token} onChange={setToken} spellCheck={false} />
      </Field>
      <Button className="mt-auto self-start" disabled={busy || !url.trim() || !token.trim()} onClick={() => void create(url, token)}>
        {getString("linked_create")}
      </Button>
    </Card>
  );
}

function JoinGroup() {
  const { join, busy } = useLinkedDevicesStore();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const onScanned = useCallback(
    (text: string) => {
      setScanning(false);
      void join(text);
    },
    [join],
  );
  return (
    <Card title={getString("linked_join_title")} subtitle={getString("linked_join_subtitle")} className="col-span-12 lg:col-span-6">
      {scanning ? (
        <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />
      ) : (
        <>
          <TextInput value={code} onChange={setCode} placeholder={getString("linked_join_placeholder")} spellCheck={false} />
          <div className="mt-auto flex gap-2">
            <Button disabled={busy || !code.trim()} onClick={() => void join(code)}>
              {getString("linked_join")}
            </Button>
            <Button variant="tonal" disabled={busy} onClick={() => setScanning(true)}>
              <Camera className="h-4 w-4" /> {getString("linked_scan")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function RestoreGroup() {
  const { restore, busy } = useLinkedDevicesStore();
  const [url, setUrl] = useState("");
  const [words, setWords] = useState("");
  return (
    <Card title={getString("linked_restore_title")} subtitle={getString("linked_restore_subtitle")} className="col-span-12">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-4">
          <Field label={getString("linked_server_url")}>
            <TextInput value={url} onChange={setUrl} placeholder={getString("linked_server_url_placeholder")} spellCheck={false} />
          </Field>
        </div>
        <div className="col-span-12 lg:col-span-8">
          <Field label={getString("linked_restore_words")}>
            <TextInput type="password" value={words} onChange={setWords} spellCheck={false} autoComplete="off" />
          </Field>
        </div>
      </div>
      <Button variant="tonal" className="self-start" disabled={busy || !url.trim() || !words.trim()} onClick={() => void restore(url, words)}>
        {getString("linked_restore")}
      </Button>
    </Card>
  );
}

/** For a device in no group yet: start one, join one, or restore one. */
export function LinkedSetup() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <CreateGroup />
      <JoinGroup />
      <RestoreGroup />
    </div>
  );
}
