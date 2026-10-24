import { getString } from "../../../lib/i18n/index";
import { useEqStore } from "../../../store/useEqStore";

/** Held down, the players hear the unequalized sound; let go, the equalizer comes back. */
export function EqCompareButton({ className = "" }: { className?: string }) {
  const bypass = useEqStore((s) => s.bypass);
  const setBypass = useEqStore((s) => s.setBypass);
  const release = () => setBypass(false);

  return (
    <button
      type="button"
      aria-pressed={bypass}
      onPointerDown={(event) => {
        (event.target as Element).setPointerCapture(event.pointerId);
        setBypass(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) setBypass(true);
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") release();
      }}
      onBlur={release}
      className={`select-none rounded-full px-3 py-1.5 text-sm transition-colors duration-200 ease-out ${
        bypass
          ? "bg-chrome-zinc-100 text-chrome-zinc-950"
          : "bg-surface-container-high text-chrome-neutral-200 hover:bg-surface-container-highest"
      } ${className}`}
    >
      {getString("eq_compare")}
    </button>
  );
}
