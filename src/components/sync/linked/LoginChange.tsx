import { useState } from "react";

import type { LinkedDevice, LinkedStatus, WebdavLogin } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";
import { WebdavLoginFields } from "./WebdavLoginFields";

const CARD = "col-span-12";

/** The new login is on its way: which devices have it, and what the user does next. */
function Waiting({ waiting, devices }: { waiting: string[]; devices: LinkedDevice[] }) {
  const { finishLoginChange, cancelLoginChange, busy } = useLinkedDevicesStore();
  const names = waiting.map((id) => devices.find((device) => device.id === id)?.name ?? id.slice(0, 8));
  return (
    <Card title={getString("linked_login_change_title")} className={CARD}>
      <p className="text-sm text-chrome-neutral-400">
        {names.length > 0
          ? getString("linked_login_change_waiting", names.join(", "))
          : getString("linked_login_change_everyone")}
      </p>
      <p className="text-sm text-chrome-neutral-400">{getString("linked_login_change_now")}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void finishLoginChange()}>
          {getString("linked_login_change_done")}
        </Button>
        <Button variant="tonal" disabled={busy} onClick={() => void cancelLoginChange()}>
          {getString("linked_cancel")}
        </Button>
      </div>
    </Card>
  );
}

/** Takes the new login, before the user sets it at the provider, so the other devices get it first. */
function NewLogin({ due }: { due: boolean }) {
  const { startLoginChange, busy } = useLinkedDevicesStore();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState<WebdavLogin>({ user: "", password: "" });
  if (!due && !open) {
    return (
      <Button variant="tonal" className={`${CARD} justify-self-start`} disabled={busy} onClick={() => setOpen(true)}>
        {getString("linked_login_change_title")}
      </Button>
    );
  }
  return (
    <Card
      title={getString("linked_login_change_title")}
      subtitle={getString(due ? "linked_login_change_due" : "linked_login_change_first")}
      className={CARD}
    >
      {due && <p className="text-sm text-chrome-neutral-400">{getString("linked_login_change_first")}</p>}
      <WebdavLoginFields login={login} onChange={setLogin} />
      <Button
        className="self-start"
        disabled={busy || !login.user.trim() || !login.password}
        onClick={() => void startLoginChange(login.user, login.password)}
      >
        {getString("linked_login_change_send")}
      </Button>
    </Card>
  );
}

/** Replacing the login of a WebDAV folder (FLOW-SYNC/2, Replacing a store's login). */
export function LoginChange({ status, devices }: { status: LinkedStatus; devices: LinkedDevice[] }) {
  return status.loginWaiting ? (
    <Waiting waiting={status.loginWaiting} devices={devices} />
  ) : (
    <NewLogin due={status.loginDue} />
  );
}
