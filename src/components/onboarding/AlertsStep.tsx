import { BellRing } from "lucide-react";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { useBoolPref } from "../../lib/usePreference";

/** New-video alerts, the same switch Settings has. */
export function AlertsStep() {
  const [alerts, setAlerts] = useBoolPref(SETTINGS.NOTIFICATIONS_ENABLED, true);
  return (
    <div className="flex w-full flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="mb-3 text-5xl font-semibold tracking-tight text-chrome-neutral-100">
          {getString("onboarding_alerts_title")}
        </h1>
        <p className="text-lg text-chrome-neutral-400">{getString("onboarding_alerts_subtitle")}</p>
      </div>
      <div className="flex items-center gap-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
        <BellRing className="shrink-0 text-chrome-neutral-400" size={20} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-chrome-neutral-100">{getString("onboarding_alerts_new_videos")}</div>
          <div className="text-sm text-chrome-neutral-400">{getString("onboarding_alerts_new_videos_summary")}</div>
        </div>
        <ToggleSwitch checked={alerts} onChange={setAlerts} />
      </div>
      <p className="text-sm text-chrome-neutral-500">{getString("onboarding_alerts_footnote")}</p>
    </div>
  );
}
