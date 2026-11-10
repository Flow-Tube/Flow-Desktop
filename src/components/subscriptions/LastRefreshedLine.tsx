import { getPlural, getString } from "../../lib/i18n/index";
import { formatTimeAgo } from "../../lib/timeAgo";

interface LastRefreshedLineProps {
  refreshedAt: number;
  checkedCount: number;
  showCount: boolean;
}

export function LastRefreshedLine({ refreshedAt, checkedCount, showCount }: LastRefreshedLineProps) {
  const when = formatTimeAgo(refreshedAt, Date.now());
  return (
    <p className="mb-4 text-sm tabular-nums text-chrome-neutral-400">
      {showCount
        ? `${getString("subscriptions_last_refreshed", when)} - ${getPlural("subscriptions_videos_checked", checkedCount)}`
        : getString("subscriptions_last_refreshed", when)}
    </p>
  );
}
