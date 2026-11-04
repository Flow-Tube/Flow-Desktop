import { useState } from "react";

import type { WebdavLogin } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";
import { WebdavLoginFields } from "./WebdavLoginFields";

/** Shown once the WebDAV folder refused its login: nothing syncs until a new one works. */
export function LoginRefused() {
  const { updateLogin, busy } = useLinkedDevicesStore();
  const [login, setLogin] = useState<WebdavLogin>({ user: "", password: "" });
  return (
    <Card title={getString("linked_login_refused_title")} subtitle={getString("linked_login_refused_body")}>
      <WebdavLoginFields login={login} onChange={setLogin} />
      <Button
        className="self-start"
        disabled={busy || !login.user.trim() || !login.password}
        onClick={() => void updateLogin(login.user, login.password)}
      >
        {getString("linked_login_save")}
      </Button>
    </Card>
  );
}
