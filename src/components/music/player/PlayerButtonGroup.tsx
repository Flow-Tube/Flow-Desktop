import { createContext, useContext, useState, type ReactNode } from "react";
import { motion } from "framer-motion";

/**
 * The full player's top row as an M3 Expressive button group, after Android's player controls:
 * every button sits on its own tonal container, so the row reads on a bright cover too, and the
 * pressed one widens and squares its corners while its neighbours give way, on an elastic spring.
 */

const SIZE = 44;
const PRESSED = 56;
const GIVING_WAY = 40;
const ROUND = SIZE / 2;
const PRESSED_CORNER = 14;
// Android's elastic spec: damping ratio 0.62 at stiffness 720.
const ELASTIC = { type: "spring", stiffness: 720, damping: 2 * 0.62 * Math.sqrt(720), mass: 1 } as const;

/** The button inside an item: it fills the item and takes the item's animated corners. */
export const GROUP_BUTTON =
  "grid h-11 w-full place-items-center rounded-[var(--group-corner)] bg-[var(--player-tonal)] text-[var(--player-ink)] transition-colors duration-200 ease-out hover:bg-[var(--player-tonal-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--player-primary)]";
/** A switched-on toggle fills with the control colour, as the play button does, so it stands out from the row. */
export const GROUP_BUTTON_ACTIVE =
  "grid h-11 w-full place-items-center rounded-[var(--group-corner)] bg-[var(--player-primary)] text-[var(--player-on-primary)] transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--player-primary)]";
/** HapticButton's own shrink is left out: here the press is the width and shape. */
export const NO_TAP_SCALE = { scale: 1 };

const Pressed = createContext<{ pressed: string | null; setPressed: (update: (id: string | null) => string | null) => void }>({
  pressed: null,
  setPressed: () => {},
});

export function PlayerButtonGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [pressed, setPressed] = useState<string | null>(null);
  return (
    <Pressed.Provider value={{ pressed, setPressed }}>
      <div role="group" className={`flex items-center gap-1.5 ${className}`}>
        {children}
      </div>
    </Pressed.Provider>
  );
}

/** One slot of the group. Anything can sit in it; an item whose button renders nothing takes no space. */
export function GroupItem({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const { pressed, setPressed } = useContext(Pressed);
  const isPressed = pressed === id;
  const release = () => setPressed((current) => (current === id ? null : current));
  return (
    <motion.div
      initial={false}
      animate={{
        width: isPressed ? PRESSED : pressed ? GIVING_WAY : SIZE,
        "--group-corner": `${isPressed ? PRESSED_CORNER : ROUND}px`,
      }}
      transition={ELASTIC}
      // Only the slot's own button presses it: a menu or popover it opens is drawn inside the slot too.
      onPointerDown={(event) => {
        const trigger = event.currentTarget.querySelector("button");
        if (trigger?.contains(event.target as Node)) setPressed(() => id);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      data-pressed={isPressed || undefined}
      className={`relative h-11 shrink-0 empty:hidden ${className}`}
    >
      {children}
    </motion.div>
  );
}
