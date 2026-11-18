import type { KeychainProblem } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { keychainCopy } from "../../../lib/keychainCopy";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";

/** Shown while the keychain hasn't given this device's keys, with what to do about it on this system. */
export function KeychainBlocked({ problem }: { problem: KeychainProblem }) {
  const { retryKeychain, busy } = useLinkedDevicesStore();
  const copy = keychainCopy(problem);
  return (
    <Card title={getString(copy.title)} subtitle={getString(copy.body)}>
      <Button className="self-start" disabled={busy} onClick={() => void retryKeychain()}>
        {getString("linked_retry")}
      </Button>
    </Card>
  );
}
