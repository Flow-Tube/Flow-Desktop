import { KeyRound, Link2, Plus } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { SettingItem } from "../../settings/SettingItem";
import { SettingsGroup } from "../../settings/SettingsGroup";
import { Spinner } from "../SyncParts";
import { ContestNotice } from "./ContestNotice";
import { KeychainBlocked } from "./KeychainBlocked";
import { LinkedOverview } from "./LinkedOverview";
import { LoginRefused } from "./LoginRefused";
import { StoppedNotice } from "./StoppedNotice";

export type LinkedTask = "join" | "start" | "restore";

const ICON = "h-5 w-5";

/** Linked devices (FLOW-SYNC/2) on the Sync page: what needs the user first, else the ways in or the group. */
export function LinkedHome({ onTask }: { onTask: (task: LinkedTask) => void }) {
  const status = useLinkedDevicesStore((state) => state.status);
  const title = getString("sync_keep_in_sync");
  if (!status) {
    return (
      <SettingsGroup title={title}>
        <div className="px-5 py-4">
          <Spinner className="h-5 w-5 text-chrome-neutral-400" />
        </div>
      </SettingsGroup>
    );
  }
  if (status.stopped) return <StoppedNotice reason={status.stopped} />;
  if (status.keychainBlocked) return <KeychainBlocked />;
  if (!status.kind) {
    return (
      <SettingsGroup title={title}>
        <SettingItem
          icon={<Link2 className={ICON} />}
          title={getString("linked_join_title")}
          description={getString("linked_join_row")}
          onSelect={() => onTask("join")}
        />
        <SettingItem
          icon={<Plus className={ICON} />}
          title={getString("linked_setup_title")}
          description={getString("linked_start_row")}
          onSelect={() => onTask("start")}
        />
        <SettingItem
          icon={<KeyRound className={ICON} />}
          title={getString("linked_restore_title")}
          description={getString("linked_restore_row")}
          onSelect={() => onTask("restore")}
        />
      </SettingsGroup>
    );
  }
  if (status.loginRefused) return <LoginRefused />;
  if (status.lastSync?.error === "linkedContested") return <ContestNotice />;
  return <LinkedOverview status={status} />;
}
