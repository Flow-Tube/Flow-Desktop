export interface Share {
  label: string;
  value: number;
  /** A `fill-*` token. */
  fill: string;
  /** The same token for the legend's swatch. */
  swatch: string;
}

const WIDTH = 420;
const HEIGHT = 16;
const GAP = 2;

interface SplitBarProps {
  shares: Share[];
  format: (value: number) => string;
  ariaLabel: string;
}

/** Shares of a whole as one bar, with a legend naming each part and its value. */
export function SplitBar({ shares, format, ariaLabel }: SplitBarProps) {
  const total = shares.reduce((sum, share) => sum + share.value, 0);
  const usable = WIDTH - GAP * (shares.length - 1);
  let x = 0;
  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
        {shares.map((share) => {
          const width = total > 0 ? (share.value / total) * usable : 0;
          const segment = <rect key={share.label} x={x} y={0} width={width} height={HEIGHT} rx={4} className={share.fill} />;
          x += width + GAP;
          return segment;
        })}
      </svg>
      <ul className="flex flex-col gap-1.5">
        {shares.map((share) => (
          <li key={share.label} className="flex items-center gap-2 text-sm text-on-surface-variant">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${share.swatch}`} />
            <span className="min-w-0 flex-1 truncate">{share.label}</span>
            <span className="tabular-nums text-on-surface">{format(share.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
