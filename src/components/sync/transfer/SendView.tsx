import { useState } from "react";
import { QrCode } from "lucide-react";

import { SYNC_COLLECTIONS } from "../../../lib/api/sync";
import { getString } from "../../../lib/i18n/index";
import { useSyncStore } from "../../../store/useSyncStore";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Button } from "../../ui/Button";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Spinner } from "../SyncParts";
import { collectionDesc, collectionTitle } from "./TransferScreens";

/** What to send to a nearby device, all of it to start with, and the button that shows the code. */
export function SendView() {
  const { startHost, busy } = useSyncStore();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(SYNC_COLLECTIONS.map((c) => c.key)));
  const toggle = (key: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={getString("sync_send_list_label")}>
        {SYNC_COLLECTIONS.map((collection) => (
          <SettingItem key={collection.key} title={collectionTitle(collection.key)} description={collectionDesc(collection.key)}>
            <ToggleSwitch checked={selected.has(collection.key)} onChange={() => toggle(collection.key)} />
          </SettingItem>
        ))}
      </SettingsGroup>
      <Button
        className="self-start focus-visible:ring-2 focus-visible:ring-primary"
        disabled={busy || selected.size === 0}
        onClick={() => void startHost([...selected])}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
        {getString("sync_generate_code")}
      </Button>
    </div>
  );
}
