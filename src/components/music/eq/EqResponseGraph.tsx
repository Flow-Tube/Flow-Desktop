import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { fractionOf, frequencyAt, magnitudeDb } from "../../../lib/audio/eq/filterMath";
import { useElementWidth } from "../../../lib/useElementWidth";
import { GraphicEq } from "../../../lib/audio/eq/limits";
import { EqLimits, hasGain, type EqBand } from "../../../lib/audio/eq/models";

const POINTS = 160;
const LABELS: [number, string][] = [
  [31, "31"],
  [125, "125"],
  [500, "500"],
  [2_000, "2k"],
  [8_000, "8k"],
  [16_000, "16k"],
];

export interface EqGraphHandle {
  band: EqBand;
  /** Graphic sliders only move up and down. */
  verticalOnly: boolean;
}

export interface EqResponseGraphProps {
  /** Every filter that shapes the sound, bass boost included. */
  bands: readonly EqBand[];
  /** Draggable points; none for the read-only mini graph. */
  handles?: readonly EqGraphHandle[];
  selected?: number | null;
  height?: number;
  rangeDb?: number;
  onSelect?: (index: number) => void;
  /** A point moved; the band it now describes. */
  onDrag?: (index: number, band: EqBand) => void;
  onDragEnd?: () => void;
  onAddAt?: (frequency: number, gain: number) => void;
  ariaLabel: string;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** The equalizer's frequency response, drawn from the same maths that sets the filters. */
export function EqResponseGraph({
  bands,
  handles = [],
  selected = null,
  height = 180,
  rangeDb = 15,
  onSelect,
  onDrag,
  onDragEnd,
  onAddAt,
  ariaLabel,
}: EqResponseGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Drawn at its real pixel size, so points stay round and labels unstretched.
  const width = useElementWidth(svgRef, 600);

  const xOf = (frequency: number) => fractionOf(frequency) * width;
  const yOf = (db: number) => height / 2 - (clamp(db, -rangeDb, rangeDb) / rangeDb) * (height / 2 - 6);

  const path = useMemo(() => {
    let d = "";
    for (let i = 0; i <= POINTS; i++) {
      const f = frequencyAt(i / POINTS);
      d += `${i === 0 ? "M" : "L"}${((i / POINTS) * width).toFixed(1)},${yOf(magnitudeDb(bands, f)).toFixed(1)}`;
    }
    return d;
  }, [bands, width, height, rangeDb]);

  const pointerToValues = (event: PointerEvent | { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const gain = ((0.5 - y) * 2 * rangeDb * height) / (height - 12);
    return { frequency: frequencyAt(x), gain: clamp(gain, -rangeDb, rangeDb) };
  };

  const moveHandle = (index: number, event: PointerEvent) => {
    const handle = handles[index];
    const values = pointerToValues(event);
    if (!handle || !values || !onDrag) return;
    const { band } = handle;
    if (handle.verticalOnly) {
      const step = GraphicEq.STEP;
      const gain = clamp(Math.round(values.gain / step) * step, -GraphicEq.MAX_GAIN, GraphicEq.MAX_GAIN);
      onDrag(index, { ...band, gain: gain + 0 });
      return;
    }
    onDrag(index, {
      ...band,
      frequency: Math.round(values.frequency),
      gain: hasGain(band.type) ? Math.round(values.gain * 10) / 10 : 0,
    });
  };

  // The wheel widens or narrows the selected band, on the same log scale as its Q slider.
  const onWheel = (index: number, event: WheelEvent) => {
    const handle = handles[index];
    if (!handle || handle.verticalOnly || !onDrag) return;
    const factor = Math.pow(1.1, event.deltaY > 0 ? -1 : 1);
    onDrag(index, { ...handle.band, q: clamp(handle.band.q * factor, EqLimits.MIN_Q, EqLimits.MAX_Q) });
    onDragEnd?.();
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="block w-full touch-none select-none"
      style={{ height }}
      onDoubleClick={(event) => {
        const values = onAddAt ? pointerToValues(event) : null;
        if (values) onAddAt?.(Math.round(values.frequency), Math.round(values.gain * 10) / 10);
      }}
    >
      {[-12, -6, 0, 6, 12]
        .filter((db) => Math.abs(db) < rangeDb)
        .map((db) => (
          <line
            key={db}
            x1={0}
            x2={width}
            y1={yOf(db)}
            y2={yOf(db)}
            style={{ stroke: "var(--color-chrome-neutral-800)", strokeWidth: db === 0 ? 1.5 : 1 }}
          />
        ))}
      {LABELS.map(([f, label]) => (
        <g key={f}>
          <line
            x1={xOf(f)}
            x2={xOf(f)}
            y1={0}
            y2={height}
            style={{ stroke: "var(--color-chrome-neutral-800)", strokeWidth: 1 }}
          />
          {height >= 120 && (
            <text
              x={xOf(f) + 4}
              y={height - 6}
              style={{ fill: "var(--color-chrome-neutral-500)", fontSize: 11 }}
            >
              {label}
            </text>
          )}
        </g>
      ))}
      <path
        d={path}
        fill="none"
        style={{ stroke: "var(--color-primary)", strokeWidth: 2 }}
      />
      {handles.map((handle, index) => {
        const { band } = handle;
        const active = index === selected || index === dragging;
        return (
          <circle
            key={index}
            cx={xOf(band.frequency)}
            cy={yOf(hasGain(band.type) ? band.gain : 0)}
            r={active ? 7 : 5}
            className="cursor-grab"
            style={{
              fill: band.enabled ? "var(--color-primary)" : "var(--color-chrome-neutral-600)",
              stroke: "var(--color-surface-container)",
              strokeWidth: 2,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              (event.target as Element).setPointerCapture(event.pointerId);
              setDragging(index);
              onSelect?.(index);
            }}
            onPointerMove={(event) => {
              if (dragging === index) moveHandle(index, event);
            }}
            onPointerUp={() => {
              if (dragging !== index) return;
              setDragging(null);
              onDragEnd?.();
            }}
            onPointerCancel={() => {
              setDragging(null);
              onDragEnd?.();
            }}
            onWheel={(event) => onWheel(index, event)}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        );
      })}
    </svg>
  );
}
