import type { ContentVector, UserBrain } from "../../lib/api/recommendation";
import { topicLabel } from "../../lib/topicLabel";
import { Activity, Brain, Clock, Moon, Sun, Sunrise, Sunset } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface TimePatternsProps {
  brain: UserBrain;
}

interface Archetype {
  id: string;
  label: string;
  time: string;
  buckets: string[];
  icon: LucideIcon;
}

const ARCHETYPES: Archetype[] = [
  {
    id: "morning",
    label: "Morning Focus",
    time: "5 AM - 12 PM",
    buckets: ["WeekdayMorning", "WeekendMorning"],
    icon: Sunrise,
  },
  {
    id: "afternoon",
    label: "Afternoon Baseline",
    time: "12 PM - 5 PM",
    buckets: ["WeekdayAfternoon", "WeekendAfternoon"],
    icon: Sun,
  },
  {
    id: "evening",
    label: "Evening Lean",
    time: "5 PM - 10 PM",
    buckets: ["WeekdayEvening", "WeekendEvening"],
    icon: Sunset,
  },
  {
    id: "night",
    label: "Night Mode",
    time: "10 PM - 5 AM",
    buckets: ["WeekdayNight", "WeekendNight"],
    icon: Moon,
  },
  {
    id: "weekend",
    label: "Weekend Drift",
    time: "Sat - Sun",
    buckets: ["WeekendMorning", "WeekendAfternoon", "WeekendEvening", "WeekendNight"],
    icon: Clock,
  },
];

function getCurrentTimeBucket(): string {
  const date = new Date();
  const day = date.getDay();
  const hour = date.getHours();
  const isWeekend = day === 0 || day === 6;
  const period =
    hour >= 5 && hour < 12
      ? "Morning"
      : hour >= 12 && hour < 17
        ? "Afternoon"
        : hour >= 17 && hour < 22
          ? "Evening"
          : "Night";

  return `${isWeekend ? "Weekend" : "Weekday"}${period}`;
}

function fallbackVector(): ContentVector {
  return {
    topics: {},
    topic_confidence: {},
    anchor_topics: [],
    pacing: 0.5,
    complexity: 0.5,
    duration: 0.5,
    is_live: 0,
  };
}

function averageVectors(vectors: ContentVector[]): ContentVector {
  if (vectors.length === 0) return fallbackVector();

  const topics: Record<string, number> = {};
  vectors.forEach((vector) => {
    Object.entries(vector.topics || {}).forEach(([topic, value]) => {
      topics[topic] = Math.max(topics[topic] || 0, value);
    });
  });

  return {
    topics,
    topic_confidence: {},
    anchor_topics: [],
    pacing: vectors.reduce((sum, vector) => sum + (vector.pacing ?? 0.5), 0) / vectors.length,
    complexity: vectors.reduce((sum, vector) => sum + (vector.complexity ?? 0.5), 0) / vectors.length,
    duration: vectors.reduce((sum, vector) => sum + (vector.duration ?? 0.5), 0) / vectors.length,
    is_live: vectors.reduce((sum, vector) => sum + (vector.is_live ?? 0), 0) / vectors.length,
  };
}

function toPercent(value: number) {
  return Math.round(value * 100);
}

export function TimePatterns({ brain }: TimePatternsProps) {
  const currentBucket = getCurrentTimeBucket();

  return (
    <section className="w-full rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">
          Temporal Taste Archetypes
        </h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          Five time-based recommendation states summarized from weekly listening and viewing patterns.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-outline-variant)]">
        <div className="grid grid-cols-1 divide-y divide-[var(--color-outline-variant)] md:grid-cols-5 md:divide-x md:divide-y-0">
          {ARCHETYPES.map((archetype) => {
            const Icon = archetype.icon;
            const isActive = archetype.buckets.includes(currentBucket);
            const vectors = archetype.buckets
              .map((bucket) => brain.time_vectors?.[bucket])
              .filter((vector): vector is ContentVector => Boolean(vector));
            const vector = averageVectors(vectors);
            const topTopics = Object.entries(vector.topics || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([topic]) => topicLabel(brain, topic));

            return (
              <article
                key={archetype.id}
                className={`min-h-48 p-4 ${isActive ? "bg-[var(--color-surface-container-high)]" : "bg-[var(--color-surface-container-low)]"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[var(--color-on-surface)]">
                      <Icon className="h-4 w-4 text-[var(--color-on-surface-variant)]" />
                      <h4 className="truncate text-sm font-semibold">{archetype.label}</h4>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-on-surface-variant)]">{archetype.time}</p>
                  </div>
                  {isActive && (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-primary)]">
                      Active
                    </span>
                  )}
                </div>

                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-[var(--color-on-surface-variant)]">
                      <Activity className="h-3.5 w-3.5" />
                      Pacing
                    </span>
                    <span className="font-mono text-[var(--color-on-surface)]">{toPercent(vector.pacing)}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-[var(--color-on-surface-variant)]">
                      <Brain className="h-3.5 w-3.5" />
                      Complexity
                    </span>
                    <span className="font-mono text-[var(--color-on-surface)]">{toPercent(vector.complexity)}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 text-[var(--color-on-surface-variant)]">
                      <Clock className="h-3.5 w-3.5" />
                      Duration
                    </span>
                    <span className="font-mono text-[var(--color-on-surface)]">{toPercent(vector.duration)}%</span>
                  </div>
                </div>

                <div className="mt-5 min-h-9 text-xs text-[var(--color-on-surface-variant)]">
                  {topTopics.length > 0 ? topTopics.join(" / ") : "Cold start context"}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
