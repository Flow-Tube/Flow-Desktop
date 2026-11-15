import { formatTime } from "../../../lib/musicFormat";
import type { MiniBarButton } from "../../../lib/music/miniPlayerLook";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";
import { useSplitTransport } from "../player/PlayerTransport";
import { BarProgress } from "./BarProgress";
import { DockTrackInfo } from "./DockTrackInfo";
import type { DockModel } from "./dockModel";
import { MiniBarButtonView } from "./MiniBarButtonView";
import { PillTransport } from "./PillTransport";
import { pillSlots } from "./pillGroups";

/** What a device this one controls can do from here: its transport and Play on. */
const AWAY_BUTTONS = new Set<MiniBarButton>(["previous", "play_pause", "next", "play_on"]);

function PillTime({ remaining }: { remaining: boolean }) {
  const progress = useMusicPlayerStore((s) => s.progress);
  const duration = useMusicPlayerStore((s) => s.duration);
  const text = remaining ? `-${formatTime(Math.max(0, duration - progress))}` : formatTime(progress);
  return <span className="shrink-0 font-mono text-xs tabular-nums text-chrome-neutral-400">{text}</span>;
}

/** The Pill: a round cover with its progress ring, the song, and the buttons the user chose, in order. */
export function PillDockBody({ model }: { model: DockModel }) {
  const split = useSplitTransport();
  const { look, away } = model;
  const buttons = away ? model.buttons.filter((button) => AWAY_BUTTONS.has(button)) : model.buttons;
  // Away, the device's own progress is not this player's, so the bar draws none.
  const showTime = !away && look.time !== "off" && look.width !== "compact";
  return (
    <>
      {!away && <BarProgress style={look.barProgress} />}
      <div className="flex min-w-0 flex-1 items-center">
        <DockTrackInfo model={model} round />
      </div>
      {showTime && <PillTime remaining={look.time === "remaining"} />}
      {/* Left to right in every language, like the timeline. */}
      <div dir="ltr" className="flex shrink-0 items-center gap-1">
        {pillSlots(buttons, split).map((slot) =>
          slot.kind === "transport" ? (
            <PillTransport key={slot.buttons.join("+")} buttons={slot.buttons} playing={model.playing} busy={model.busy} />
          ) : (
            <MiniBarButtonView key={slot.button} button={slot.button} ctx={model} />
          ),
        )}
      </div>
    </>
  );
}
