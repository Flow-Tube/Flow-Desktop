import { useEffect } from "react";
import { Link2 } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { IconChip, Spinner } from "../SyncParts";
import { LinkPanel } from "./LinkPanel";
import { LinkedOverview } from "./LinkedOverview";
import { LinkedSetup } from "./LinkedSetup";
import { RecoveryWords } from "./RecoveryWords";
import { RemovedNotice } from "./RemovedNotice";

function Body() {
  const { status, words, link } = useLinkedDevicesStore();
  if (!status) return <Spinner className="h-5 w-5 text-chrome-neutral-400" />;
  if (words) return <RecoveryWords words={words} />;
  if (link.phase !== "idle") return <LinkPanel link={link} joining={!status.linked} />;
  if (!status.linked) return <LinkedSetup />;
  if (status.lastSync?.error === "linkedRemoved") return <RemovedNotice />;
  return <LinkedOverview status={status} />;
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
