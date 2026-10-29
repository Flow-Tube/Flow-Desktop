import { useState } from "react";
import { Wifi } from "lucide-react";

import type { WebdavLogin } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { TextInput } from "../../ui/TextInput";
import { Card, Field } from "./Card";
import { WebdavLoginFields } from "./WebdavLoginFields";

type Place = "server" | "webdav" | "lan";

function OnServer() {
  const { create, busy } = useLinkedDevicesStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  return (
    <>
      <Field label={getString("linked_server_url")}>
        <TextInput value={url} onChange={setUrl} placeholder={getString("linked_server_url_placeholder")} spellCheck={false} />
      </Field>
      <Field label={getString("linked_admin_token")} hint={getString("linked_admin_token_hint")}>
        <TextInput type="password" value={token} onChange={setToken} spellCheck={false} />
      </Field>
      <Button className="mt-auto self-start" disabled={busy || !url.trim() || !token.trim()} onClick={() => void create(url, token)}>
        {getString("linked_create")}
      </Button>
    </>
  );
}

function OnWebdav() {
  const { createOnWebdav, busy } = useLinkedDevicesStore();
  const [url, setUrl] = useState("");
  const [login, setLogin] = useState<WebdavLogin>({ user: "", password: "" });
  const ready = url.trim() && login.user.trim() && login.password;
  return (
    <>
      <Field label={getString("linked_webdav_url")}>
        <TextInput value={url} onChange={setUrl} placeholder={getString("linked_webdav_url_placeholder")} spellCheck={false} />
      </Field>
      <WebdavLoginFields login={login} onChange={setLogin} />
      <Button
        className="mt-auto self-start"
        disabled={busy || !ready}
        onClick={() => void createOnWebdav(url, login.user, login.password)}
      >
        {getString("linked_create")}
      </Button>
    </>
  );
}

function OnLan() {
  const { createOnLan, busy } = useLinkedDevicesStore();
  return (
    <>
      <p className="text-sm text-chrome-neutral-400">{getString("linked_lan_hint")}</p>
      <Button className="mt-auto self-start" disabled={busy} onClick={() => void createOnLan()}>
        <Wifi className="h-4 w-4" /> {getString("linked_create_lan")}
      </Button>
    </>
  );
}

/** Starts a group on a Flow server, in a WebDAV folder, or only on this network's devices. */
export function CreateGroup() {
  const [place, setPlace] = useState<Place>("server");
  return (
    <Card title={getString("linked_setup_title")} subtitle={getString("linked_setup_subtitle")} className="col-span-12 lg:col-span-6">
      <SegmentedControl<Place>
        label={getString("linked_store_choice")}
        value={place}
        onChange={setPlace}
        options={[
          { value: "server", label: getString("linked_store_server") },
          { value: "webdav", label: getString("linked_store_webdav") },
          { value: "lan", label: getString("linked_store_lan") },
        ]}
      />
      {place === "server" && <OnServer />}
      {place === "webdav" && <OnWebdav />}
      {place === "lan" && <OnLan />}
    </Card>
  );
}
