import { Activity } from "lucide-react";
import { useLearningActivity } from "../../lib/useLearningActivity";
import { getString, type StringKey } from "../../lib/i18n/index";

const EVENT_STYLES: Record<string, { label: StringKey; tone: string }> = {
  CLICK: { label: "learning_event_opened", tone: "text-chrome-sky-400" },
  LIKED: { label: "learning_event_liked", tone: "text-chrome-emerald-400" },
  WATCHED: { label: "learning_event_watched", tone: "text-chrome-emerald-400" },
  SKIPPED: { label: "learning_event_skipped", tone: "text-chrome-amber-400" },
  DISLIKED: { label: "learning_event_disliked", tone: "text-chrome-red-400" },
  NOT_INTERESTED: { label: "learning_event_not_interested", tone: "text-chrome-red-400" },
};

// SQLite stores UTC timestamps without a zone marker; normalize before parsing.
function relativeTime(raw: string): string {
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (!Number.isFinite(ms)) return "";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function LearningActivity() {
  const { events, loading } = useLearningActivity(40);

  return (
    <section className="rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--color-primary)]" />
        <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
          Recent Learning Activity
        </h2>
      </div>

      {loading ? (
        <p className="text-xs text-[var(--color-on-surface-variant)]">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-[var(--color-on-surface-variant)]">
          No signals recorded yet. Watching, liking, and dismissing videos will appear here.
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col divide-y divide-[var(--color-outline-variant)] overflow-y-auto">
          {events.map((event, index) => {
            const known = EVENT_STYLES[event.eventType];
            const style = known
              ? { label: getString(known.label), tone: known.tone }
              : { label: event.eventType, tone: "text-[var(--color-on-surface-variant)]" };
            return (
              <li
                key={event.id ?? index}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <p className="min-w-0 truncate">
                  <span className={`font-semibold ${style.tone}`}>{style.label}</span>
                  <span className="text-[var(--color-on-surface-variant)]">
                    {" · "}
                    {event.channelName ?? event.query ?? "unknown"}
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--color-on-surface-variant)]">
                  {event.value != null && (
                    <span className="font-mono">
                      {event.value >= 0 ? "+" : ""}
                      {event.value.toFixed(2)}
                    </span>
                  )}
                  <span>{relativeTime(event.createdAt)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
