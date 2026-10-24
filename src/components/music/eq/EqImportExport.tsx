import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClipboardCopy, FileDown, FileUp } from "lucide-react";

import { parseAutoEq } from "../../../lib/audio/eq/autoEqFormat";
import { eqExportText, presetNameFromFile, saveEqTextFile } from "../../../lib/audio/eq/eqFiles";
import { hasNonButterworthShelf } from "../../../lib/audio/eq/graphPlan";
import { newPresetId } from "../../../lib/audio/eq/stateJson";
import { importPreset, isNameAvailable, normalizedPresetName } from "../../../lib/audio/eq/stateOps";
import { builtInPresetNames } from "../../../lib/audio/eq/useEqualizer";
import { copyText } from "../../../lib/clipboard";
import { getString } from "../../../lib/i18n/index";
import { useEqStore } from "../../../store/useEqStore";
import { useUiStore } from "../../../store/useUiStore";
import { formatDb } from "./eqFormat";

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-sm text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-40";

/** AutoEQ / EqualizerAPO import from a file or pasted text, with a preview, and export. */
export function EqImportExport() {
  const state = useEqStore((s) => s.state);
  const update = useEqStore((s) => s.update);
  const showToast = useUiStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  const parsed = useMemo(() => (text.trim() ? parseAutoEq(text) : null), [text]);
  const wanted = normalizedPresetName(name || getString("eq_import_default_name"));
  const nameFree = isNameAvailable(state, wanted, builtInPresetNames());

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setText(await file.text());
      setName(presetNameFromFile(file.name));
    } catch {
      showToast({ message: getString("eq_import_read_failed"), variant: "error" });
    }
  };

  const runImport = () => {
    if (!parsed || !nameFree) return;
    update((s) => importPreset(s, newPresetId(), wanted, parsed.curve));
    showToast({ message: getString("eq_import_done", wanted), variant: "success" });
    setText("");
    setName("");
  };

  const exportToFile = async () => {
    try {
      const saved = await saveEqTextFile(eqExportText(state), getString("eq_export_file"), "ParametricEQ.txt");
      if (saved) showToast({ message: getString("eq_export_saved"), variant: "success" });
    } catch {
      showToast({ message: getString("eq_export_failed"), variant: "error" });
    }
  };

  const exportToClipboard = async () => {
    const copied = await copyText(eqExportText(state));
    showToast({
      message: getString(copied ? "eq_export_copied" : "eq_export_failed"),
      variant: copied ? "success" : "error",
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={getString("eq_import_paste")}
        aria-label={getString("eq_import_paste")}
        rows={4}
        spellCheck={false}
        className="w-full resize-y rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 font-mono text-xs text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out placeholder:font-sans placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-600"
      />

      {text.trim() !== "" && (
        <div className="rounded-lg border border-chrome-neutral-800 px-3 py-2 text-xs text-chrome-neutral-400">
          {parsed ? (
            <ul className="space-y-0.5">
              <li className="text-chrome-neutral-200">
                {getString("eq_import_summary", parsed.curve.bands.length, formatDb(parsed.curve.preamp))}
              </li>
              {parsed.skippedFilters > 0 && <li>{getString("eq_import_skipped", parsed.skippedFilters)}</li>}
              {parsed.ignoredLines > 0 && <li>{getString("eq_import_ignored", parsed.ignoredLines)}</li>}
              {parsed.truncatedFilters > 0 && <li>{getString("eq_import_truncated", parsed.truncatedFilters)}</li>}
              {hasNonButterworthShelf(parsed.curve) && <li>{getString("eq_import_shelf_q")}</li>}
            </ul>
          ) : (
            <span className="text-chrome-red-400">{getString("eq_import_invalid")}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-4 w-4" />
          {getString("eq_import_file")}
        </button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={onFile} />
        {parsed && (
          <>
            <input
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder={getString("eq_import_default_name")}
              aria-label={getString("eq_preset_name")}
              className="min-w-[10rem] flex-1 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-1.5 text-sm text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out focus:border-chrome-neutral-600"
            />
            <button
              type="button"
              onClick={runImport}
              disabled={!nameFree}
              className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-on-primary)] transition-opacity duration-200 ease-out disabled:opacity-40"
            >
              {getString("eq_import")}
            </button>
          </>
        )}
      </div>
      {parsed && !nameFree && <span className="text-xs text-chrome-red-400">{getString("eq_name_taken")}</span>}

      <div className="flex flex-wrap items-center gap-2 border-t border-chrome-neutral-800 pt-3">
        <span className="mr-auto text-sm text-chrome-neutral-300">{getString("eq_export")}</span>
        <button type="button" className={BUTTON} onClick={() => void exportToFile()}>
          <FileDown className="h-4 w-4" />
          {getString("eq_export_file")}
        </button>
        <button type="button" className={BUTTON} onClick={() => void exportToClipboard()}>
          <ClipboardCopy className="h-4 w-4" />
          {getString("eq_export_copy")}
        </button>
      </div>
    </div>
  );
}
