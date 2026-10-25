import { useEffect, type FormEvent, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { getString } from "../../lib/i18n/index";

interface ScrobbleDialogProps {
  title: string;
  submitLabel: string;
  submitDisabled: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}

export function ScrobbleDialog({ title, submitLabel, submitDisabled, onSubmit, onCancel, children }: ScrobbleDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submitDisabled) onSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-chrome-black/70 p-6" role="dialog" aria-modal="true" aria-labelledby="scrobble-dialog-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-chrome-neutral-800 bg-background">
        <h2 id="scrobble-dialog-title" className="px-6 pt-5 text-lg font-semibold text-chrome-neutral-100">{title}</h2>
        <div className="space-y-3 px-6 py-4">{children}</div>
        <footer className="flex justify-end gap-2 border-t border-chrome-neutral-800 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onCancel}>{getString("cancel")}</Button>
          <Button type="submit" disabled={submitDisabled}>{submitLabel}</Button>
        </footer>
      </form>
    </div>
  );
}
