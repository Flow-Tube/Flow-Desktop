import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { interestTopics, type UserBrain } from "../../lib/api/recommendation";

interface TasteShapeProps {
  brain: UserBrain;
}

interface VectorMetric {
  key: string;
  label: string;
  helper: string;
  global: number;
  context: number;
}

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

function calculateBreadth(topics: Record<string, number> = {}) {
  return Math.min(1, Object.keys(topics).length / 12);
}

function toPercent(value: number) {
  return Math.round(value * 100);
}

export function TasteShape({ brain }: TasteShapeProps) {
  const currentBucket = getCurrentTimeBucket();
  const currentVector = brain.time_vectors[currentBucket] || {
    topics: {},
    pacing: 0.5,
    complexity: 0.5,
    duration: 0.5,
    is_live: 0,
  };

  const metrics: VectorMetric[] = [
    {
      key: "pacing",
      label: "Pacing",
      helper: "Calm to high velocity content",
      global: brain.global_vector.pacing ?? 0.5,
      context: currentVector.pacing ?? 0.5,
    },
    {
      key: "complexity",
      label: "Complexity",
      helper: "Casual to technical material",
      global: brain.global_vector.complexity ?? 0.5,
      context: currentVector.complexity ?? 0.5,
    },
    {
      key: "duration",
      label: "Duration",
      helper: "Short sessions to long form",
      global: brain.global_vector.duration ?? 0.5,
      context: currentVector.duration ?? 0.5,
    },
    {
      key: "live",
      label: "Live Affinity",
      helper: "Recorded to livestream",
      global: brain.global_vector.is_live ?? 0,
      context: currentVector.is_live ?? 0,
    },
    {
      key: "breadth",
      label: "Topic Breadth",
      helper: "Narrow focus to broad exploration",
      global: calculateBreadth(interestTopics(brain.global_vector.topics)),
      context: calculateBreadth(interestTopics(currentVector.topics)),
    },
  ];

  const chartData = metrics.map((metric) => ({
    subject: metric.label,
    Global: toPercent(metric.global),
    Context: toPercent(metric.context),
  }));

  return (
    <section className="flex h-full w-full flex-col rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-[var(--color-on-surface)]">Taste Shape Radar</h3>
        <p className="text-sm text-[var(--color-on-surface-variant)]">
          Global preference shape compared with the active time context, {currentBucket}.
        </p>
      </div>

      <div className="mt-6 h-[280px] w-full select-none">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="76%" data={chartData}>
            <PolarGrid stroke="var(--color-outline-variant)" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: "var(--color-on-surface-variant)", fontSize: 11, fontWeight: 600 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: "var(--color-on-surface-variant)", fontSize: 10 }}
              axisLine={false}
              tickCount={4}
            />
            <Radar
              name="Global"
              dataKey="Global"
              stroke="var(--color-primary)"
              strokeWidth={1.5}
              fill="var(--color-primary)"
              fillOpacity={0.2}
              dot={false}
            />
            <Radar
              name="Current context"
              dataKey="Context"
              stroke="var(--color-on-surface-variant)"
              strokeWidth={1}
              fill="var(--color-on-surface-variant)"
              fillOpacity={0.08}
              dot={false}
            />
            <Tooltip
              cursor={false}
              contentStyle={{
                backgroundColor: "var(--color-surface-container-high)",
                borderColor: "var(--color-outline-variant)",
                borderRadius: "12px",
                color: "var(--color-on-surface)",
                boxShadow: "none",
              }}
              itemStyle={{ color: "var(--color-on-surface)" }}
              labelStyle={{ color: "var(--color-on-surface-variant)" }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-[var(--color-on-surface-variant)]">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" />
          Global
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--color-on-surface-variant)]" />
          Current context
        </span>
      </div>

      <div className="mt-6 divide-y divide-[var(--color-outline-variant)]">
        {metrics.map((metric) => (
          <div key={metric.key} className="grid grid-cols-[1fr_auto] gap-4 py-3">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-[var(--color-on-surface)]">{metric.label}</p>
                <p className="font-mono text-sm text-[var(--color-on-surface)]">
                  {toPercent(metric.global)}%
                </p>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-on-surface-variant)]">{metric.helper}</p>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-outline-variant)]">
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${toPercent(metric.global)}%` }}
                />
              </div>
            </div>
            <div className="w-16 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                Context
              </p>
              <p className="mt-1 font-mono text-sm text-[var(--color-on-surface)]">
                {toPercent(metric.context)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
