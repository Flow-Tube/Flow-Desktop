import { useEffect, useState } from "react";
import { Copy, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";

import { newPresetId } from "../../../lib/audio/eq/stateJson";
import {
  deletePreset,
  duplicatePreset,
  isNameAvailable,
  normalizedPresetName,
  renamePreset,
  restorePreset,
  revert,
  saveActive,
  saveActiveAs,
  type DeletedEqPreset,
} from "../../../lib/audio/eq/stateOps";
import {
  builtInPresetNames,
  pickEqPreset,
  restoreCustomEq,
  useEqualizer,
} from "../../../lib/audio/eq/useEqualizer";
import { getString } from "../../../lib/i18n/index";
import { useEqStore } from "../../../store/useEqStore";
import { Chip } from "../../ui/Chip";

type NameAction = "saveAs" | "rename" | "duplicate";

const UNDO_MS = 6_000;

const ACTION_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-xs text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest disabled:opacity-40";

/** Preset chips with Save, Save as, Rename, Duplicate, Delete and Undo. */
export function EqPresetBar() {
  const eq = useEqualizer();
  const update = useEqStore((s) => s.update);
  const [naming, setNaming] = useState<NameAction | null>(null);
  const [name, setName] = useState("");
  const [deleted, setDeleted] = useState<DeletedEqPreset | null>(null);

  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);

  const selectedId = eq.active.presetId;
  const exceptId = naming === "rename" ? selectedId : null;
  const wanted = normalizedPresetName(name);
  const nameFree = isNameAvailable(eq.state, wanted, builtInPresetNames(), exceptId);

  const startNaming = (action: NameAction) => {
    setNaming(action);
    const base = eq.activeName ?? getString("eq_preset_custom");
    setName(action === "rename" ? base : getString("eq_copy_name", base));
  };

  const submitName = () => {
    if (!naming || !nameFree) return;
    if (naming === "saveAs") update((s) => saveActiveAs(s, newPresetId(), wanted));
    if (naming === "rename" && selectedId) update((s) => renamePreset(s, selectedId, wanted));
    if (naming === "duplicate" && selectedId) update((s) => duplicatePreset(s, selectedId, newPresetId(), wanted));
    setNaming(null);
  };

  const remove = () => {
    if (!selectedId) return;
    const [, removed] = deletePreset(eq.state, selectedId);
    if (!removed) return;
    update((s) => deletePreset(s, selectedId)[0]);
    setDeleted(removed);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {eq.hasCustom && (
          <Chip
            active={selectedId === null}
            onClick={() => restoreCustomEq(eq.state.mode)}
            className="h-7 px-2.5 text-xs"
          >
            {getString("eq_preset_custom")}
          </Chip>
        )}
        {eq.presets.map((preset) => (
          <Chip
            key={preset.id}
            active={preset.id === selectedId}
            onClick={() => pickEqPreset(preset.id)}
            className="h-7 px-2.5 text-xs"
          >
            {preset.name}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {eq.edited && (
          <>
            <span className="rounded-full border border-chrome-neutral-700 px-2 py-0.5 text-[11px] uppercase tracking-widest text-chrome-neutral-400">
              {getString("eq_edited")}
            </span>
            {selectedId && (
              <button type="button" className={ACTION_BUTTON} onClick={() => update(revert)}>
                <RotateCcw className="h-3.5 w-3.5" />
                {getString("eq_revert")}
              </button>
            )}
          </>
        )}
        {eq.canSave && (
          <button type="button" className={ACTION_BUTTON} onClick={() => update(saveActive)}>
            <Save className="h-3.5 w-3.5" />
            {getString("eq_save")}
          </button>
        )}
        <button type="button" className={ACTION_BUTTON} onClick={() => startNaming("saveAs")}>
          <Save className="h-3.5 w-3.5" />
          {getString("eq_save_as")}
        </button>
        {selectedId && (
          <button type="button" className={ACTION_BUTTON} onClick={() => startNaming("duplicate")}>
            <Copy className="h-3.5 w-3.5" />
            {getString("eq_duplicate")}
          </button>
        )}
        {eq.selectedIsUserPreset && (
          <>
            <button type="button" className={ACTION_BUTTON} onClick={() => startNaming("rename")}>
              <Pencil className="h-3.5 w-3.5" />
              {getString("eq_rename")}
            </button>
            <button type="button" className={ACTION_BUTTON} onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
              {getString("eq_delete")}
            </button>
          </>
        )}
      </div>

      {naming && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitName();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setNaming(null);
              }
            }}
            aria-label={getString("eq_preset_name")}
            className="min-w-[12rem] flex-1 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-1.5 text-sm text-chrome-neutral-100 outline-none transition-colors duration-200 ease-out focus:border-chrome-neutral-600"
          />
          <button
            type="submit"
            disabled={!nameFree}
            className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-sm font-medium text-[var(--color-on-primary)] transition-opacity duration-200 ease-out disabled:opacity-40"
          >
            {getString("eq_save")}
          </button>
          <button type="button" className={ACTION_BUTTON} onClick={() => setNaming(null)}>
            {getString("cancel")}
          </button>
          {wanted !== "" && !nameFree && (
            <span className="w-full text-xs text-chrome-red-400">{getString("eq_name_taken")}</span>
          )}
        </form>
      )}

      {deleted && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-3 py-2 text-sm text-chrome-neutral-300">
          <span>{getString("eq_deleted", deleted.preset.name)}</span>
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={() => {
              update((s) => restorePreset(s, deleted));
              setDeleted(null);
            }}
          >
            {getString("undo")}
          </button>
        </div>
      )}
    </div>
  );
}
