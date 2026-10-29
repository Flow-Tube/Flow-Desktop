import { useEffect } from "react";
import { Check, X } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Card } from "./Card";

const POLL_MS = 3000;

/** Devices asking to join this server group, checked while the page is open. */
export function JoinRequests() {
  const { joinRequests, loadJoinRequests, acceptJoin, declineJoin, busy } = useLinkedDevicesStore();
  useEffect(() => {
    void loadJoinRequests();
    const timer = window.setInterval(() => void loadJoinRequests(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadJoinRequests]);
  if (joinRequests.length === 0) return null;
  return (
    <Card title={getString("linked_join_requests")} subtitle={getString("linked_join_request_hint")} className="col-span-12">
      {joinRequests.map((request) => (
        <div key={request.id} className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-chrome-neutral-100">
            {getString("linked_join_request", request.name)}
          </p>
          <Button size="sm" disabled={busy} onClick={() => void acceptJoin(request.id)}>
            <Check className="h-4 w-4" /> {getString("linked_accept")}
          </Button>
          <Button size="sm" variant="tonal" disabled={busy} onClick={() => void declineJoin(request.id)}>
            <X className="h-4 w-4" /> {getString("linked_decline")}
          </Button>
        </div>
      ))}
    </Card>
  );
}
