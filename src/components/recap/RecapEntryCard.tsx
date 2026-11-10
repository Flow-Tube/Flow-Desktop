import { ChartNoAxesColumn } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { getString } from "../../lib/i18n/index";
import { periodLabel } from "../../lib/recap/recapFormat";
import { recapPath } from "../../lib/recap/recapPath";
import { useRecapReadiness } from "../../lib/recap/useRecapReadiness";
import { Button } from "../ui/Button";

/** The way into Recap from Library, saying so when a month or year has just closed. */
export function RecapEntryCard() {
  const navigate = useNavigate();
  const { ready, markHandled } = useRecapReadiness();
  const open = () => {
    const target = ready;
    markHandled();
    navigate(recapPath(target));
  };
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-outline-variant bg-surface-container-low px-5 py-4">
      <ChartNoAxesColumn className="h-6 w-6 shrink-0 text-chrome-neutral-400" />
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-medium text-on-surface">
          {ready ? getString("recap_ready_title", periodLabel(ready)) : getString("recap_title")}
        </h2>
        <p className="text-sm text-on-surface-variant">{getString(ready ? "recap_ready_body" : "recap_summary")}</p>
      </div>
      {ready && (
        <Button variant="ghost" size="sm" onClick={markHandled}>
          {getString("recap_ready_dismiss")}
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={open}>
        {getString("recap_open")}
      </Button>
    </section>
  );
}
