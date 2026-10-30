import { Monitor, Smartphone, Tablet, Tv } from "lucide-react";

import type { DeviceKind } from "../../lib/api/live";

const ICONS = { phone: Smartphone, tablet: Tablet, tv: Tv, desktop: Monitor } as const;

export function DeviceKindIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}
