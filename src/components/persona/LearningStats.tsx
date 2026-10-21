import type { UserBrain } from "../../lib/api/recommendation";
import {
  BarChart2,
  BookOpen,
  FileText,
  History,
  Layers,
  ShieldAlert,
  ThumbsDown,
  Tv,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getString } from "../../lib/i18n/index";

interface LearningStatsProps {
  brain: UserBrain;
}

interface StatItem {
  label: string;
  value: number;
  icon: LucideIcon;
}

function formatStat(value: number) {
  return value.toLocaleString();
}

export function LearningStats({ brain }: LearningStatsProps) {
  const stats: StatItem[] = [
    {
      label: getString("persona_stat_interactions"),
      value: brain.total_interactions || 0,
      icon: BarChart2,
    },
    {
      label: getString("persona_stat_topics"),
      value: Object.keys(brain.topic_evidence || {}).length,
      icon: BookOpen,
    },
    {
      label: getString("persona_stat_evidence"),
      value: Object.values(brain.topic_evidence || {}).filter((topic) => topic.positive_score >= 1).length,
      icon: Layers,
    },
    {
      label: getString("persona_stat_channels"),
      value: Object.keys(brain.channel_scores || {}).length,
      icon: Tv,
    },
    {
      label: getString("persona_stat_sessions"),
      value: Object.keys(brain.watch_history_map || {}).length,
      icon: History,
    },
    {
      label: getString("persona_stat_impressions"),
      value: Object.keys(brain.feed_history || {}).length,
      icon: FileText,
    },
    {
      label: getString("persona_stat_suppressions"),
      value:
        Object.keys(brain.suppressed_video_ids || {}).length +
        Object.keys(brain.suppressed_channels || {}).length,
      icon: ShieldAlert,
    },
    {
      label: getString("persona_stat_rejections"),
      value: Object.keys(brain.rejection_patterns || {}).length,
      icon: ThumbsDown,
    },
  ];

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <div
            key={stat.label}
            className="relative min-h-28 rounded-2xl bg-[var(--color-surface-container-low)] border border-[var(--color-outline-variant)] p-4"
          >
            <Icon className="absolute right-4 top-4 h-5 w-5 text-[var(--color-on-surface-variant)] opacity-70" />
            <div className="pr-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                {stat.label}
              </p>
              <p className="mt-5 font-mono text-3xl leading-none text-[var(--color-on-surface)]">
                {formatStat(stat.value)}
              </p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
