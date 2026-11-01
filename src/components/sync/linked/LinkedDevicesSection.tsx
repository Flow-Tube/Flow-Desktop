import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import type { LinkedStatus } from "../../../lib/api/linked";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { IconChip, Spinner } from "../SyncParts";
import { Dashboard } from "./Dashboard";
import { KeychainBlocked } from "./KeychainBlocked";
import { LinkPanel } from "./LinkPanel";
import { LinkedOverview } from "./LinkedOverview";
import { LinkedSetup } from "./LinkedSetup";
import { LoginRefused } from "./LoginRefused";
import { RecoveryWords } from "./RecoveryWords";
import { StoppedNotice } from "./StoppedNotice";

function Body() {
  const { status, words, link } = useLinkedDevicesStore();
  if (!status) return <Spinner className="h-5 w-5 text-chrome-neutral-400" />;
  if (words) return <RecoveryWords words={words} />;
  if (link.phase !== "idle") return <LinkPanel link={link} joining={!status.kind} />;
  if (status.stopped) return <StoppedNotice reason={status.stopped} />;
  if (status.keychainBlocked) return <KeychainBlocked />;
  if (!status.kind) return <LinkedSetup />;
  if (status.loginRefused) return <LoginRefused />;
  return <LinkedTabs status={status} />;
}

type Tab = "devices" | "dashboard";

/** A device in a group: its devices and profiles, or the dashboard. */
function LinkedTabs({ status }: { status: LinkedStatus }) {
  const [tab, setTab] = useState<Tab>("devices");
  return (
    <div className="flex flex-col gap-4">
      <div className="self-start">
        <SegmentedControl<Tab>
          label={getString("linked_tabs_label")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "devices", label: getString("linked_tab_devices") },
            { value: "dashboard", label: getString("linked_tab_dashboard") },
          ]}
        />
      </div>
      {tab === "devices" ? <LinkedOverview status={status} /> : <Dashboard />}
    </div>
  );
}

/** FLOW-SYNC/2: devices that stay in sync through a Flow server. */
export function LinkedDevicesSection() {
  const { init, error } = useLinkedDevicesStore();
  useEffect(() => {
    void init();
  }, [init]);
  return (
    <section className="mx-auto mt-12 max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <IconChip>
          <Link2 className="h-5 w-5" />
        </IconChip>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{getString("linked_title")}</h2>
          <p className="max-w-2xl text-sm text-chrome-neutral-400">{getString("linked_subtitle")}</p>
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-sm text-chrome-red-400">
          {error}
        </div>
      )}
      <Body />
    </section>
  );
}
