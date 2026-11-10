import type { ReactNode } from "react";

interface RecapCardProps {
  title: string;
  subtitle?: string;
  /** Tailwind `col-span-*` classes for the page's grid. */
  span: string;
  children: ReactNode;
}

export function RecapCard({ title, subtitle, span, children }: RecapCardProps) {
  return (
    <section className={`${span} flex min-w-0 flex-col gap-4 rounded-2xl border border-outline-variant bg-surface-container-low p-5`}>
      <header>
        <h2 className="text-base font-medium text-on-surface">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-on-surface-variant">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

interface FigureProps {
  value: string;
  label: string;
  emphasized?: boolean;
}

/** One number with what it counts. */
export function Figure({ value, label, emphasized = false }: FigureProps) {
  return (
    <div className="min-w-0">
      <div className={`font-bold tabular-nums tracking-tight text-on-surface ${emphasized ? "text-4xl" : "text-2xl"}`}>{value}</div>
      <div className="text-sm text-on-surface-variant">{label}</div>
    </div>
  );
}
