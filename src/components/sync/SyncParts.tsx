import { Loader2 } from "lucide-react";

import { getString } from "../../lib/i18n/index";

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

/** Sleek neutral icon chip used in the section headers (clinical, never colored). */
export function IconChip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-chrome-neutral-200">
      {children}
    </div>
  );
}

export function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <IconChip>{icon}</IconChip>
      <div>
        <h2 className="text-xl font-bold tracking-tight text-chrome-neutral-100">{title}</h2>
        <p className="max-w-2xl text-sm text-chrome-neutral-400">{subtitle}</p>
      </div>
    </div>
  );
}

/** The 6-digit verification code, rendered as massive spaced monospace digits. */
export function VerificationCode({ sas, size = "lg" }: { sas: string; size?: "lg" | "md" }) {
  return (
    <div className="flex flex-col items-center">
      <span className="mb-3 text-xs font-semibold uppercase tracking-widest text-chrome-neutral-500">
        {getString("sync_verification_code")}
      </span>
      <span
        className={`font-mono font-bold text-chrome-neutral-100 tracking-[0.3em] ${
          size === "lg" ? "text-5xl" : "text-3xl"
        }`}
      >
        {sas}
      </span>
    </div>
  );
}
