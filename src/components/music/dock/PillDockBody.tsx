import type { MiniBarButton } from "../../../lib/music/miniPlayerLook";
import { DockTrackInfo } from "./DockTrackInfo";
import type { DockModel } from "./dockModel";
import { MiniBarButtonView } from "./MiniBarButtonView";

/** What a device this one controls can do from here: its transport and Play on. */
const AWAY_BUTTONS = new Set<MiniBarButton>(["previous", "play_pause", "next", "play_on"]);

/** The Pill: a round cover with its progress ring, the song, and the buttons the user chose, in order. */
export function PillDockBody({ model }: { model: DockModel }) {
  const buttons = model.away ? model.buttons.filter((button) => AWAY_BUTTONS.has(button)) : model.buttons;
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        <DockTrackInfo model={model} round />
      </div>
      {/* Left to right in every language, like the timeline. */}
      <div dir="ltr" className="flex shrink-0 items-center gap-1">
        {buttons.map((button) => (
          <MiniBarButtonView key={button} button={button} ctx={model} />
        ))}
      </div>
    </>
  );
}
