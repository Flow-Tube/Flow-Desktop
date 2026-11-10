import { useEffect, useRef, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { MESH_SIZE, type LyricsCover } from "../../../lib/lyrics/display/coverMesh";
import { useMusicPlayerStore } from "../../../store/useMusicPlayerStore";

const COVER_SCALE = 1.4;
const DRIFT_SCALE = 2.2;
const SECOND_LAYER_OPACITY = 0.6;

/** The cover's colours, drawn once into a tiny canvas the browser stretches smoothly. */
function MeshCanvas({ mesh, className, style }: { mesh: Uint8ClampedArray; className: string; style: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(mesh), MESH_SIZE, MESH_SIZE), 0, 0);
  }, [mesh]);
  return <canvas ref={ref} width={MESH_SIZE} height={MESH_SIZE} aria-hidden="true" className={className} style={style} />;
}

/**
 * One copy of the field on its own path: across and down at different periods, scaled past the
 * screen's edges at every point of the path so no edge of the field ever shows.
 */
function DriftLayer({ mesh, periodX, periodY, scale, opacity }: { mesh: Uint8ClampedArray; periodX: number; periodY: number; scale: number; opacity: number }) {
  return (
    <div className="lyrics-drift-x absolute inset-0" style={{ animationDuration: `${periodX}s`, opacity }}>
      <div className="lyrics-drift-y absolute inset-0" style={{ animationDuration: `${periodY}s` }}>
        <MeshCanvas mesh={mesh} className="absolute inset-0 h-full w-full" style={{ transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

/**
 * Port of Android's LyricsCoverLayer: the cover as a soft colour field behind the full-screen
 * lyrics. Moving lays a second, flipped copy over the first and sends the two on different paths, so
 * the colours flow through each other; it only moves these layers, and stops with the song.
 */
export function LyricsCoverBackground({ cover, moving }: { cover: LyricsCover | null; moving: boolean }) {
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying);
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${isPlaying ? "" : "lyrics-drift-paused"}`}>
      <AnimatePresence initial={false}>
        {cover && (
          <motion.div
            key={`${moving}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {moving ? (
              <>
                <DriftLayer mesh={cover.mesh} periodX={16} periodY={22} scale={DRIFT_SCALE} opacity={1} />
                <DriftLayer mesh={cover.mesh} periodX={24} periodY={28} scale={-DRIFT_SCALE} opacity={SECOND_LAYER_OPACITY} />
              </>
            ) : (
              <MeshCanvas mesh={cover.mesh} className="absolute inset-0 h-full w-full object-cover" style={{ transform: `scale(${COVER_SCALE})` }} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
