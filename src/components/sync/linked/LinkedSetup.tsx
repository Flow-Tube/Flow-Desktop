import { useState } from "react";
import { KeyRound, QrCode, Wifi } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { Card, Field } from "./Card";
import { CodeEntry } from "./CodeEntry";

function CreateGroup() {
  const { create, createOnLan, busy } = useLinkedDevicesStore();
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
      <div className="mt-auto flex flex-wrap gap-2">
        <Button disabled={busy || !url.trim() || !token.trim()} onClick={() => void create(url, token)}>
          {getString("linked_create")}
        </Button>
        <Button variant="tonal" disabled={busy} onClick={() => void createOnLan()}>
          <Wifi className="h-4 w-4" /> {getString("linked_create_lan")}
        </Button>
      </div>
    </Card>
  );
}

/** Joins a server group with its address and admin token instead of a code. */
function AskToJoin() {
  const { askToJoin, busy } = useLinkedDevicesStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <>
      <Field label={getString("linked_server_url")}>
        <TextInput value={url} onChange={setUrl} placeholder={getString("linked_server_url_placeholder")} spellCheck={false} />
      </Field>
      <Field label={getString("linked_admin_token")} hint={getString("linked_ask_to_join_hint")}>
        <TextInput type="password" value={token} onChange={setToken} spellCheck={false} />
      </Field>
      <Button className="mt-auto self-start" disabled={busy || !url.trim() || !token.trim()} onClick={() => void askToJoin(url, token)}>
        {getString("linked_ask_to_join")}
      </Button>
    </>
  );
}

function JoinGroup() {
  const { showCode, busy } = useLinkedDevicesStore();
  const [withToken, setWithToken] = useState(false);
  return (
    <Card title={getString("linked_join_title")} subtitle={getString("linked_join_subtitle")} className="col-span-12 lg:col-span-6">
      {withToken ? (
        <AskToJoin />
      ) : (
        <CodeEntry>
          <Button variant="tonal" disabled={busy} onClick={() => void showCode()}>
            <QrCode className="h-4 w-4" /> {getString("linked_show_code")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setWithToken(true)}>
            <KeyRound className="h-4 w-4" /> {getString("linked_use_admin_token")}
          </Button>
        </CodeEntry>
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
