import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Download, Folder, Loader2, X } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { useProxiedImageUrl } from "../../../lib/useProxiedImageUrl";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";
import { DOWNLOAD_SURFACE_SPRING } from "../surface";

export function DialogFrame({
  children,
  onClose,
  width = "max-w-[560px]",
}: {
  children: ReactNode;
  onClose: () => void;
  width?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An open menu inside the dialog claims Escape first.
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] grid place-items-center p-5">
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={DOWNLOAD_SURFACE_SPRING}
        className={`pointer-events-auto flex max-h-[calc(100vh-40px)] w-full ${width} flex-col overflow-hidden rounded-2xl border border-chrome-neutral-800 bg-surface`}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** The item being downloaded: its artwork, title and credit line. */
export function DialogHeader({
  artwork,
  shape,
  fallbackIcon,
  title,
  subtitle,
  meta,
  badge,
  onClose,
}: {
  artwork: string | null | undefined;
  shape: "landscape" | "square";
  fallbackIcon: ReactNode;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  badge?: string | null;
  onClose: () => void;
}) {
  const src = useProxiedImageUrl(artwork);
  const [broken, setBroken] = useState(false);
  const frame = shape === "landscape" ? "aspect-video w-32" : "aspect-square w-[88px]";
  return (
    <div className="flex items-start gap-4 px-5 pb-4 pt-5">
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-surface-container-high ${frame}`}>
        {src && !broken ? (
          <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="grid h-full w-full place-items-center text-chrome-neutral-500">{fallbackIcon}</div>
        )}
        {badge ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-chrome-black/75 px-1.5 py-0.5 font-mono text-[10px] text-chrome-white">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-base font-semibold leading-snug text-chrome-neutral-100">{title}</h2>
        {subtitle ? <p className="mt-1 truncate text-sm text-chrome-neutral-400">{subtitle}</p> : null}
        {meta ? <p className="mt-0.5 truncate font-mono text-xs text-chrome-neutral-500">{meta}</p> : null}
      </div>
      <button
        type="button"
        aria-label={getString("close")}
        onClick={onClose}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100"
      >
        <X size={18} />
      </button>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-widest text-chrome-neutral-500">{children}</span>
  );
}

/** The last segment of a folder path, so the footer stays one line. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join(" › ") || path;
}

/** File name (editable in place), destination folder, and the actions. */
export function DialogFooter({
  fileName,
  extension,
  onRename,
  folder,
  onChangeFolder,
  sizeLabel,
  primaryLabel,
  starting,
  disabled,
  onCancel,
  onSubmit,
}: {
  fileName: string;
  extension?: string;
  onRename?: (name: string) => void;
  folder: string;
  onChangeFolder: () => void;
  sizeLabel?: string | null;
  primaryLabel?: string;
  starting: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-chrome-neutral-800 bg-surface-container-low px-5 py-3">
      <div className="min-w-0 flex-1">
        {editing && onRename ? (
          <TextInput
            value={fileName}
            onChange={onRename}
            autoFocus
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setEditing(false);
            }}
            className="h-8 w-full"
            aria-label={getString("download_file_name")}
          />
        ) : (
          <button
            type="button"
            disabled={!onRename}
            onClick={() => setEditing(true)}
            title={onRename ? getString("download_rename") : undefined}
            className="block max-w-full truncate text-left text-sm text-chrome-neutral-200 enabled:hover:text-chrome-neutral-100"
          >
            {fileName}
            {extension ? <span className="text-chrome-neutral-500">.{extension}</span> : null}
          </button>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-chrome-neutral-500">
          <Folder size={12} />
          <span className="truncate" title={folder}>{folderName(folder)}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={onChangeFolder}
            className="font-medium text-chrome-neutral-400 underline-offset-2 transition-colors hover:text-chrome-neutral-100 hover:underline"
          >
            {getString("download_folder_change")}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel}>{getString("cancel")}</Button>
        <Button onClick={onSubmit} disabled={disabled || starting}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download size={16} />}
          {primaryLabel ?? getString("download")}
          {sizeLabel ? <span className="font-mono text-xs opacity-80">{sizeLabel}</span> : null}
        </Button>
      </div>
    </div>
  );
}

/** Rows standing in for a list that is still loading. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-chrome-neutral-800">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-t border-chrome-neutral-800 px-3 py-3 first:border-t-0">
          <div className="h-4 w-4 rounded-full bg-surface-container-high" />
          <div className="h-3 w-14 rounded bg-surface-container-high" />
          <div className="h-3 flex-1 rounded bg-surface-container" />
          <div className="h-3 w-16 rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}
