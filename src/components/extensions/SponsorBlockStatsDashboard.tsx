import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Scissors } from "lucide-react";
import { Button } from "../ui/Button";
import {
  DEFAULT_SB_COLORS,
  type SponsorBlockCategory,
} from "../../store/useSettingsStore";
import type { SponsorBlockCategoryStat } from "../../lib/useSponsorBlockCategoryStats";
import { SB_CATEGORY_META } from "../../lib/sponsorBlockCategories";

interface CategoryDatum {
  key: SponsorBlockCategory;
  label: string;
  seconds: number;
  clips: number;
  color: string;
  durationLabel: string;
}

interface SponsorBlockStatsDashboardProps {
  savedMinutes: number;
  segmentsSkipped: number;
  categoryStats: SponsorBlockCategoryStat[];
  colors: Record<SponsorBlockCategory, string>;
  onReset: () => void;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function StatTile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-chrome-neutral-800 bg-surface-container p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high text-[var(--color-primary)]">
        {icon}
      </div>
      <div className="mt-4">
        <div className="font-mono text-3xl font-bold tracking-tight text-chrome-neutral-100">{value}</div>
        <div className="mt-1 text-xs text-chrome-neutral-400">{label}</div>
      </div>
    </div>
  );
}

interface TooltipEntry {
  payload: CategoryDatum;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  const datum = active && payload && payload.length > 0 ? payload[0]?.payload : undefined;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-chrome-neutral-800 bg-surface-container-high px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-chrome-neutral-100">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: datum.color }} />
        {datum.label}
      </div>
      <div className="mt-1 font-mono text-xs text-chrome-neutral-400">
        {formatDuration(datum.seconds)} · {datum.clips} {datum.clips === 1 ? "segment" : "segments"}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
  hasData,
}: {
  title: string;
  children: React.ReactNode;
  hasData: boolean;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">{title}</h3>
      <div className="mt-4 h-[240px] w-full">
        {hasData ? (
          children
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium text-chrome-neutral-300">No skips recorded yet</p>
            <p className="text-xs text-chrome-neutral-500">Segments you skip will show up here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function SponsorBlockStatsDashboard({
  savedMinutes,
  segmentsSkipped,
  categoryStats,
  colors,
  onReset,
}: SponsorBlockStatsDashboardProps) {
  const data = useMemo<CategoryDatum[]>(
    () =>
      categoryStats
        .filter((stat) => stat.clips > 0 || stat.seconds > 0)
        .map((stat) => ({
          key: stat.category,
          label: SB_CATEGORY_META[stat.category].short,
          seconds: stat.seconds,
          clips: stat.clips,
          color: colors[stat.category] ?? DEFAULT_SB_COLORS[stat.category],
          durationLabel: formatDuration(stat.seconds),
        }))
        .sort((a, b) => b.seconds - a.seconds),
    [categoryStats, colors],
  );

  const barData = useMemo(() => data.filter((d) => d.seconds > 0), [data]);
  const pieData = useMemo(() => data.filter((d) => d.clips > 0), [data]);
  const activeCategories = data.length;
  const topCategory = data[0]?.label ?? "—";

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile icon={<Clock size={16} />} value={savedMinutes} label="Minutes saved" />
      <StatTile icon={<Scissors size={16} />} value={segmentsSkipped} label="Segments skipped" />
      <StatTile icon={<span className="font-mono text-sm font-bold">#</span>} value={activeCategories} label="Categories active" />
      <StatTile icon={<span className="text-sm">★</span>} value={topCategory} label="Most skipped" />

      <div className="col-span-2 lg:col-span-3">
        <ChartCard title="Time saved by category" hasData={barData.length > 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 2, right: 56, bottom: 2, left: 4 }}
              barCategoryGap={10}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={92}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-on-surface-variant)", fontSize: 12 }}
              />
              <Tooltip cursor={{ fill: "var(--color-surface-container-high)", opacity: 0.4 }} content={<ChartTooltip />} />
              <Bar dataKey="seconds" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {barData.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
                <LabelList
                  dataKey="durationLabel"
                  position="right"
                  fill="var(--color-on-surface-variant)"
                  fontSize={11}
                  fontWeight={600}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="col-span-2 lg:col-span-1">
        <ChartCard title="Segment share" hasData={pieData.length > 0}>
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="clips"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius="62%"
                    outerRadius="92%"
                    paddingAngle={2}
                    stroke="var(--color-surface-container-low)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-2xl font-bold text-chrome-neutral-100">{segmentsSkipped}</span>
                <span className="text-[10px] uppercase tracking-widest text-chrome-neutral-500">total</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
              {pieData.slice(0, 6).map((entry) => (
                <span key={entry.key} className="flex items-center gap-1.5 text-[11px] text-chrome-neutral-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  {entry.label}
                </span>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="col-span-2 flex justify-end lg:col-span-4">
        <Button variant="secondary" size="sm" onClick={onReset}>
          Reset stats
        </Button>
      </div>
    </div>
  );
}
