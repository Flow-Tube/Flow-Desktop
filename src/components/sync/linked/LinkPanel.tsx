import { QRCodeSVG } from "qrcode.react";
import { Check, CircleCheck, X } from "lucide-react";

import type { LinkPhase } from "../../../lib/api/linked";
import { getString } from "../../../lib/i18n/index";
import { syncErrorMessage } from "../../../lib/syncErrors";
import { useLinkedDevicesStore } from "../../../store/useLinkedDevicesStore";
import { Button } from "../../ui/Button";
import { Spinner, VerificationCode } from "../SyncParts";
import { CodeEntry } from "./CodeEntry";

function Waiting({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-chrome-neutral-400">
      <Spinner className="h-5 w-5" /> {label}
    </div>
  );
}

type Ending = "done" | "failed" | "cancelled";

function Outcome({ title, body, ending }: { title: string; body: string; ending: Ending }) {
  const tone = ending === "failed" ? "bg-chrome-red-950/30 text-chrome-red-400" : "bg-surface-container-high text-chrome-neutral-200";
  return (
    <>
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${tone}`}>
        {ending === "done" ? <CircleCheck className="h-6 w-6" /> : <X className="h-6 w-6" />}
      </div>
      <h3 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h3>
      <p className="max-w-sm text-sm text-chrome-neutral-400">{body}</p>
    </>
  );
}

/** A pairing in progress, on either side: the code to scan, the digits to compare, the outcome. */
export function LinkPanel({ link, joining }: { link: LinkPhase; joining: boolean }) {
  const { answer, closeLink, busy } = useLinkedDevicesStore();
  const finished = link.phase === "done" || link.phase === "failed";
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-8 text-center">
      {link.phase === "waiting" &&
        (link.code ? (
          <>
            <h3 className="text-xl font-bold tracking-tight text-chrome-neutral-100">
              {getString(joining ? "linked_show_title" : "linked_add_title")}
            </h3>
            <p className="max-w-sm text-sm text-chrome-neutral-400">
              {getString(joining ? "linked_show_subtitle" : "linked_add_subtitle")}
            </p>
            <div className="rounded-3xl bg-chrome-white p-6">
              <QRCodeSVG value={link.code} size={232} level="M" marginSize={1} />
            </div>
            {!joining && (
              <div className="flex w-full max-w-sm flex-col gap-3 text-left">
                <p className="text-sm text-chrome-neutral-400">{getString("linked_scan_theirs")}</p>
                <CodeEntry />
              </div>
            )}
          </>
        ) : (
          <Waiting label={getString(joining ? "linked_waiting_join" : "linked_preparing")} />
        ))}
      {link.phase === "confirm" && (
        <>
          <h3 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{getString("linked_confirm_title")}</h3>
          <p className="max-w-sm text-sm text-chrome-neutral-400">{getString("linked_confirm_subtitle")}</p>
          <VerificationCode sas={link.sas} />
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void answer(true)}>
              <Check className="h-4 w-4" /> {getString("linked_match")}
            </Button>
            <Button variant="tonal" disabled={busy} onClick={() => void answer(false)}>
              {getString("linked_no_match")}
            </Button>
          </div>
        </>
      )}
      {link.phase === "asking" && <Waiting label={getString("linked_waiting_accept")} />}
      {link.phase === "linking" && <Waiting label={getString("linked_linking")} />}
      {link.phase === "done" && <Outcome ending="done" title={getString("linked_done_title")} body={getString("linked_done_body")} />}
      {link.phase === "failed" && (
        <Outcome
          ending={link.kind === "linkedDeclined" ? "cancelled" : "failed"}
          title={getString(link.kind === "linkedDeclined" ? "linked_cancelled_title" : "linked_failed_title")}
          body={syncErrorMessage(link.kind, link.message)}
        />
      )}
      <Button variant={finished ? "primary" : "secondary"} onClick={() => void closeLink()}>
        {getString(finished ? "linked_close" : "linked_cancel")}
      </Button>
    </div>
  );
}
