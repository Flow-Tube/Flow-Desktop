import type { HistoryDateGroup as HistoryDateGroupData } from "../../lib/useHistory";
import { getPlural } from "../../lib/i18n/index";
import { MusicHistoryGrid } from "./MusicHistoryGrid";

interface MusicHistoryGroupProps {
  group: HistoryDateGroupData;
  onRemoveFromHistory: (videoId: string) => void;
}

export function MusicHistoryGroup({ group, onRemoveFromHistory }: MusicHistoryGroupProps) {
  const { dateLabel, videos } = group;

  return (
    <section className="min-w-0">
      <div className="mb-3 px-1">
        <h2 className="text-2xl font-bold tracking-tight text-chrome-neutral-100">{dateLabel}</h2>
        <p className="mt-1 text-sm text-chrome-neutral-400">
          {getPlural("history_songs_count", videos.length)}
        </p>
      </div>

      <MusicHistoryGrid videos={videos} onRemoveFromHistory={onRemoveFromHistory} />
    </section>
  );
}

export default MusicHistoryGroup;
