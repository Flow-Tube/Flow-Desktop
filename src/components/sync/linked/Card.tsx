/** A titled panel of the Linked devices section. */
export function Card({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6 ${className}`}>
      <h3 className="text-base font-medium text-chrome-neutral-200">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-chrome-neutral-400">{subtitle}</p>}
      <div className="mt-5 flex flex-1 flex-col gap-4">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-chrome-neutral-500">{hint}</span>}
    </label>
  );
}
