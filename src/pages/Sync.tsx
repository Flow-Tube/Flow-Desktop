import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownToLine, Send } from "lucide-react";

import { SettingItem } from "../components/settings/SettingItem";
import { SettingsGroup } from "../components/settings/SettingsGroup";
import { SyncTaskView } from "../components/sync/SyncTaskView";
import { CreateGroup } from "../components/sync/linked/CreateGroup";
import { LinkedHome, type LinkedTask } from "../components/sync/linked/LinkedHome";
import { JoinGroup, RestoreGroup } from "../components/sync/linked/LinkedSetup";
import { LinkPanel } from "../components/sync/linked/LinkPanel";
import { RecoveryWords } from "../components/sync/linked/RecoveryWords";
import { ReceiveView } from "../components/sync/transfer/ReceiveView";
import { SendView } from "../components/sync/transfer/SendView";
import { DefaultOnlyScreen, useTransferScreen } from "../components/sync/transfer/TransferScreens";
import { getString } from "../lib/i18n/index";
import { useLinkedDevicesStore } from "../store/useLinkedDevicesStore";
import { useProfilesStore } from "../store/useProfilesStore";
import { useSyncStore } from "../store/useSyncStore";

type Task = LinkedTask | "send" | "receive";

// Snappy, non-bouncy screen transition (Design.md §6: no long/bouncy entry animations).
const SCREEN_MOTION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

const ICON = "h-5 w-5";

function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-xl border border-chrome-red-900/50 bg-chrome-red-950/30 px-4 py-3 text-sm text-chrome-red-400">{message}</p>;
}

/** The list the page opens on: linked devices, then one-time transfer. Each task opens its own view. */
function SyncHome({ onTask }: { onTask: (task: Task) => void }) {
  const linkedError = useLinkedDevicesStore((state) => state.error);
  const transferError = useSyncStore((state) => state.error);
  const device = useSyncStore((state) => state.device);
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-chrome-neutral-100">{getString("sync_page_title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-chrome-neutral-400">{getString("sync_page_subtitle")}</p>
      </header>
      {linkedError && <ErrorNote message={linkedError} />}
      {transferError && <ErrorNote message={transferError} />}
      <LinkedHome onTask={onTask} />
      <SettingsGroup title={getString("sync_one_time_title")}>
        <SettingItem
          icon={<Send className={ICON} />}
          title={getString("sync_send_row")}
          description={getString("sync_send_row_desc")}
          onSelect={() => onTask("send")}
        />
        <SettingItem
          icon={<ArrowDownToLine className={ICON} />}
          title={getString("sync_receive_row")}
          description={getString("sync_receive_row_desc")}
          onSelect={() => onTask("receive")}
        />
      </SettingsGroup>
      {device && (
        <p className="text-center text-xs text-chrome-neutral-500">
          {getString("sync_this_device")}: <span dir="auto" className="text-chrome-neutral-300">{device.deviceName}</span>
        </p>
      )}
    </div>
  );
}

export default function Sync() {
  const initTransfer = useSyncStore((state) => state.init);
  const transferPhase = useSyncStore((state) => state.status.phase);
  const transferError = useSyncStore((state) => state.error);
  const { init: initLinked, status: linked, words, link, error: linkedError, cancelRestore } = useLinkedDevicesStore();
  const profiles = useProfilesStore((state) => state.view);
  const loadProfiles = useProfilesStore((state) => state.load);
  const transferScreen = useTransferScreen();
  const [task, setTask] = useState<Task | null>(null);

  useEffect(() => {
    void initTransfer();
    void initLinked();
    void loadProfiles();
  }, [initTransfer, initLinked, loadProfiles]);

  // A task that has done its job goes back to the list: joining, starting or restoring once this
  // device is in a group, and a transfer once its last screen is closed.
  useEffect(() => {
    if (linked?.kind) setTask((current) => (current === "join" || current === "start" || current === "restore" ? null : current));
  }, [linked?.kind]);
  const transferWasActive = useRef(false);
  useEffect(() => {
    const active = transferPhase !== "idle";
    if (transferWasActive.current && !active) setTask((current) => (current === "send" || current === "receive" ? null : current));
    transferWasActive.current = active;
  }, [transferPhase]);

  const back = () => {
    if (task === "restore") cancelRestore();
    setTask(null);
  };

  const defaultProfile =
    profiles && profiles.activeId !== profiles.defaultId
      ? profiles.profiles.find((profile) => profile.id === profiles.defaultId)
      : undefined;
  const transferBody = (view: ReactNode) => (defaultProfile ? <DefaultOnlyScreen defaultProfile={defaultProfile} /> : view);

  let screenKey: string;
  let body: ReactNode;
  if (transferScreen) {
    screenKey = `transfer-${transferScreen.screenKey}`;
    body = <SyncTaskView title={getString("sync_one_time_title")}>{transferScreen.body}</SyncTaskView>;
  } else if (words) {
    screenKey = "words";
    body = <RecoveryWords words={words} />;
  } else if (link.phase !== "idle") {
    screenKey = "link";
    body = <LinkPanel link={link} joining={!linked?.kind} />;
  } else if (task === "join") {
    screenKey = task;
    body = (
      <SyncTaskView title={getString("linked_join_title")} subtitle={getString("linked_join_subtitle")} error={linkedError} onBack={back}>
        <JoinGroup />
      </SyncTaskView>
    );
  } else if (task === "start") {
    screenKey = task;
    body = (
      <SyncTaskView title={getString("linked_setup_title")} subtitle={getString("linked_setup_subtitle")} error={linkedError} onBack={back}>
        <CreateGroup />
      </SyncTaskView>
    );
  } else if (task === "restore") {
    screenKey = task;
    body = (
      <SyncTaskView title={getString("linked_restore_title")} subtitle={getString("linked_restore_subtitle")} error={linkedError} onBack={back}>
        <RestoreGroup />
      </SyncTaskView>
    );
  } else if (task === "send") {
    screenKey = task;
    body = (
      <SyncTaskView title={getString("sync_send_row")} subtitle={getString("sync_send_subtitle")} error={transferError} onBack={back}>
        {transferBody(<SendView />)}
      </SyncTaskView>
    );
  } else if (task === "receive") {
    screenKey = task;
    body = (
      <SyncTaskView title={getString("sync_receive_row")} subtitle={getString("sync_receive_subtitle")} error={transferError} onBack={back}>
        {transferBody(<ReceiveView />)}
      </SyncTaskView>
    );
  } else {
    screenKey = "home";
    body = <SyncHome onTask={setTask} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <AnimatePresence mode="wait">
        <motion.div key={screenKey} {...SCREEN_MOTION}>
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
