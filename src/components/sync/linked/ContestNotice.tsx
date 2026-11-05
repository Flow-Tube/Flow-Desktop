import { useState } from "react";

import { getString } from "../../../lib/i18n/index";
import { useContest } from "../../../lib/linked/useContest";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Spinner } from "../SyncParts";
import { Card } from "./Card";

/** Two devices removed each other, so sync waits for the user to say which one to keep. */
export function ContestNotice() {
  const { sides, error } = useContest();
  const { keepSide, busy } = useLinkedDevicesStore();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <Card title={getString("linked_contest_title")} subtitle={getString("linked_contest_body")}>
      {error && <p className="text-sm text-chrome-red-400">{error}</p>}
      {!sides && !error && <Spinner className="h-5 w-5 text-chrome-neutral-400" />}
      {sides?.map((side) => (
        <div key={side.entry} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
          <p className="text-sm text-chrome-neutral-400">
            {getString("linked_contest_removes", side.removes.join(", "))}
          </p>
          {chosen === side.entry && (
            <p className="text-sm text-chrome-neutral-400">{getString("linked_contest_confirm")}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="tonal"
              disabled={busy}
              onClick={() => (chosen === side.entry ? void keepSide(side.entry) : setChosen(side.entry))}
            >
              {getString("linked_contest_keep", side.device)}
            </Button>
            {chosen === side.entry && (
              <Button variant="tonal" disabled={busy} onClick={() => setChosen(null)}>
                {getString("linked_cancel")}
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
