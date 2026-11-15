import { FullLayer } from "./FullLayer";
import { MiniLayer } from "./MiniLayer";

/**
 * The music player as one card, as Android's `UnifiedMusicPlayerSheet`: the mini player rides the
 * card's top edge and fades by halfway while the full player grows in behind it, both driven by one
 * progress (`lib/musicSheet`) that a drag moves either way.
 */
export function MusicPlayerSheet() {
  return (
    <>
      <MiniLayer />
      <FullLayer />
    </>
  );
}
