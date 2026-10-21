import type { ReactNode } from "react";

interface HomeFeedButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function HomeFeedButton({ onClick, disabled, children }: HomeFeedButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full border border-chrome-zinc-800 bg-chrome-zinc-900/40 px-5 py-3 text-sm font-semibold text-chrome-zinc-300 transition-colors hover:border-chrome-zinc-700 hover:text-chrome-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
