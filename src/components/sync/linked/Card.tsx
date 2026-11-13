/** A panel of the Sync page. Without a title it is the body of a view whose header already names it. */
export function Card({
  title,
  subtitle,
  className = "",
  children,
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container-low p-6 ${className}`}>
      {title && <h3 className="text-base font-medium text-chrome-neutral-200">{title}</h3>}
      {subtitle && <p className="mt-1 text-sm text-chrome-neutral-400">{subtitle}</p>}
      <div className={`flex flex-1 flex-col gap-4 ${title || subtitle ? "mt-5" : ""}`}>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-chrome-neutral-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-chrome-neutral-500">{hint}</span>}
    </label>
  );
}
