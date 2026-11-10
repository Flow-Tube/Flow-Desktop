import { AnimatePresence } from "framer-motion";
import { Bug } from "lucide-react";

import { sendCrashReport, useCrashReport } from "../../lib/crashReport";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";
import { InfoDialog } from "../ui/InfoDialog";
import { CrashReportText } from "./CrashReportText";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Offers the report the last crash left, once, at the launch after it. */
export function CrashReportHost() {
  const { file, dismiss } = useCrashReport();
  const pending = file?.pending ? file.report : null;

  return (
    <AnimatePresence>
      {pending && (
        <InfoDialog
          title={getString("crash_title")}
          closeLabel={getString("close")}
          onClose={dismiss}
          footer={
            <>
              <Button variant="ghost" className={FOCUS_RING} onClick={dismiss}>
                {getString("crash_continue")}
              </Button>
              <Button
                variant="primary"
                className={FOCUS_RING}
                onClick={() => {
                  dismiss();
                  void sendCrashReport(pending);
                }}
              >
                <Bug size={14} />
                {getString("crash_report")}
              </Button>
            </>
          }
        >
          <p className="mb-4 text-sm text-chrome-neutral-400">{getString("crash_subtitle")}</p>
          <CrashReportText report={pending} />
        </InfoDialog>
      )}
    </AnimatePresence>
  );
}
