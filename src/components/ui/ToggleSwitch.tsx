import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';

/*
  Material 3 Expressive switch. The track is 52x32 with a 24px handle, and the
  handle swells to 28px while pressed — the size change is the press feedback,
  so there is no separate hover/active fill.
*/
const TRACK_INSET = 2;
const HANDLE = 24;
const TRAVEL = 52 - 2 * (TRACK_INSET + 2) - HANDLE;
const PRESSED_SCALE = 28 / HANDLE;

/*
  M3's "fast spatial" spring: stiffness 1400 at a 0.9 damping ratio. Framer takes
  absolute damping, so 0.9 x 2 x sqrt(1400) lands at ~67 — quick, with the small
  overshoot that gives the expressive switch its snap.
*/
const SPRING = { type: 'spring' as const, stiffness: 1400, damping: 67, mass: 1 };
const REDUCED = { duration: 0.12, ease: 'easeOut' as const };

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps) {
  const [pressed, setPressed] = useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      className={`relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 px-[2px] transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-transparent bg-[var(--color-primary)]'
          : 'border-chrome-neutral-600 bg-chrome-neutral-800'
      }`}
    >
      <motion.span
        className={`grid h-6 w-6 place-items-center rounded-full ${
          checked ? 'bg-on-primary' : 'bg-chrome-neutral-400'
        }`}
        animate={{ x: checked ? TRAVEL : 0, scale: pressed && !disabled ? PRESSED_SCALE : 1 }}
        transition={reduceMotion ? REDUCED : SPRING}
      >
        {/* Both icons stay mounted and cross-fade, so neither can pop in late. */}
        <Check
          className={`col-start-1 row-start-1 h-4 w-4 text-[var(--color-primary)] transition-all duration-150 ease-out ${
            checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          }`}
          strokeWidth={3}
        />
        <X
          className={`col-start-1 row-start-1 h-4 w-4 text-chrome-neutral-800 transition-all duration-150 ease-out ${
            checked ? 'scale-50 opacity-0' : 'scale-100 opacity-100'
          }`}
          strokeWidth={3}
        />
      </motion.span>
    </button>
  );
}
