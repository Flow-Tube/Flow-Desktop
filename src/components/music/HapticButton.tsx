import { motion, type HTMLMotionProps } from "framer-motion";

export type HapticButtonProps = HTMLMotionProps<"button">;

export function HapticButton({
  children,
  type = "button",
  transition,
  ...props
}: HapticButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.9 }}
      // Critically damped: the press settles without bouncing back past its size.
      transition={transition ?? { type: "spring", stiffness: 400, damping: 40 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
