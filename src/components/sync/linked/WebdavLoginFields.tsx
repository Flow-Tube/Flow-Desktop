import type { WebdavLogin } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { TextInput } from "../../ui/TextInput";
import { Field } from "./Card";

/** The user name and password of a WebDAV folder. */
export function WebdavLoginFields({ login, onChange }: { login: WebdavLogin; onChange: (login: WebdavLogin) => void }) {
  return (
    <>
      <Field label={getString("linked_webdav_user")}>
        <TextInput value={login.user} onChange={(user) => onChange({ ...login, user })} spellCheck={false} autoComplete="off" />
      </Field>
      <Field label={getString("linked_webdav_password")} hint={getString("linked_webdav_password_hint")}>
        <TextInput
          type="password"
          value={login.password}
          onChange={(password) => onChange({ ...login, password })}
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
    </>
  );
}
