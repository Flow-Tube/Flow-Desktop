import { AnimatePresence } from "framer-motion";
import { Gauge } from "lucide-react";
import { getPlural, getString } from "../../lib/i18n/index";
import { useGraphicsTrial } from "../../lib/graphicsTrial";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/**
 * Asks whether to keep the faster graphics tier a trial launch runs on. With no
 * answer the backend restarts Flow on the earlier tier, so a blank window
 * recovers by itself. Mounted once, in the main window.
 */
export function GraphicsTrialPrompt() {
  const { secondsLeft, keep, goBack } = useGraphicsTrial();

  return (
    <AnimatePresence>
      {secondsLeft != null && (
        <ConfirmDialog
          icon={Gauge}
          title={getString("graphics_trial_title")}
          message={getPlural("graphics_trial_message", secondsLeft)}
          confirmLabel={getString("graphics_trial_keep")}
          cancelLabel={getString("graphics_trial_go_back")}
          onConfirm={keep}
          onCancel={goBack}
        />
      )}
    </AnimatePresence>
  );
}
