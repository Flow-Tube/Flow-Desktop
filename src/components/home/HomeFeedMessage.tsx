import type { ReactNode } from "react";

interface HomeFeedMessageProps {
  title: string;
  body: string;
  action?: ReactNode;
}

/** A whole-page state of Home: disabled, empty or failed. */
export function HomeFeedMessage({ title, body, action }: HomeFeedMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-chrome-zinc-800 bg-chrome-zinc-900/10 p-8 py-24 text-center">
      <div>
        <h3 className="font-bold text-chrome-zinc-300">{title}</h3>
        <p className="mt-1 max-w-sm text-xs text-chrome-zinc-500">{body}</p>
      </div>
      {action}
    </div>
  );
}
