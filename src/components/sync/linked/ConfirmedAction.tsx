import { useState, type ReactNode } from "react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { SettingItem } from "../../settings/SettingItem";
import { Button } from "../../ui/Button";

type Action = "leave" | "forget" | "replaceRecovery";
type Variant = "destructive" | "tonal";

/** A group action that runs only once the user confirms it. */
function useConfirmed(action: Action) {
  const store = useLinkedDevicesStore();
  const [confirming, setConfirming] = useState(false);
  const buttons = (label: string, variant: Variant, size?: "sm") => (
    <div className="flex gap-2">
      <Button size={size} variant={variant} disabled={store.busy} onClick={() => (confirming ? void store[action]() : setConfirming(true))}>
        {label}
      </Button>
      {confirming && (
        <Button size={size} variant="tonal" disabled={store.busy} onClick={() => setConfirming(false)}>
          {getString("linked_cancel")}
        </Button>
      )}
    </div>
  );
  return { confirming, buttons };
}

/** Runs a group action after the user confirms `confirm`. */
export function ConfirmedAction({
  action,
  label,
  confirm,
  variant = "destructive",
}: {
  action: Action;
  label: string;
  confirm: string;
  variant?: Variant;
}) {
  const { confirming, buttons } = useConfirmed(action);
  return (
    <>
      {confirming && <p className="text-sm text-chrome-neutral-400">{confirm}</p>}
      {buttons(label, variant)}
    </>
  );
}

/** The same, as a row of a settings group: the row's description turns into the question. */
export function ConfirmedActionRow({
  action,
  title,
  description,
  label,
  confirm,
  icon,
  titleClassName,
  variant = "destructive",
}: {
  action: Action;
  titleClassName?: string;
  title: string;
  description: string;
  label: string;
  confirm: string;
  icon: ReactNode;
  variant?: Variant;
}) {
  const { confirming, buttons } = useConfirmed(action);
  return (
    <SettingItem
      icon={icon}
      title={title}
      description={confirming ? confirm : description}
      titleClassName={titleClassName ?? (variant === "destructive" ? "text-chrome-red-400" : undefined)}
    >
      {buttons(label, variant, "sm")}
    </SettingItem>
  );
}
