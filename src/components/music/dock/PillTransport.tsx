import type { TransportPart } from "../../../lib/music/splitTransport";
import { upcomingIndex } from "../../../lib/musicQueueOrder";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { SplitTransport } from "../player/SplitTransport";

export type PillTransportButton = "previous" | "play_pause" | "next";

const PART: Record<PillTransportButton, TransportPart> = { previous: "previous", play_pause: "play", next: "next" };

/** Previous, Play/pause and Next sitting together in the Pill: the full player's split button, smaller. */
export function PillTransport({ buttons, playing, busy }: { buttons: PillTransportButton[]; playing: boolean; busy: boolean }) {
  const { previous, next, togglePlay } = useMusicPlayerStore.getState();
  const nextTitle = useMusicPlayerStore((s) => s.queue[upcomingIndex(s)]?.title ?? null);
  return (
    <SplitTransport
      size="mini"
      parts={buttons.map((button) => PART[button])}
      playing={playing}
      loading={busy}
      onPrevious={previous}
      onTogglePlay={togglePlay}
      onNext={next}
      nextTitle={nextTitle}
    />
  );
}
