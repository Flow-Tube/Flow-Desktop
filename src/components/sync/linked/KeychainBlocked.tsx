import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";

/** Shown while the keychain hasn't given this device's keys: macOS is asking, or access was refused. */
export function KeychainBlocked() {
  const { retryKeychain, busy } = useLinkedDevicesStore();
  return (
    <Card title={getString("linked_keychain_title")} subtitle={getString("linked_keychain_body")}>
      <Button className="self-start" disabled={busy} onClick={() => void retryKeychain()}>
        {getString("linked_retry")}
      </Button>
    </Card>
  );
}
