import { useEffect, useRef, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";

import { getString } from "../../../lib/i18n/index";
import { IS_MACOS_RUNTIME } from "../../../lib/platform";
import { saveOverrides, withCommandKeys, type ShortcutOverrides } from "../../../lib/shortcuts/bindings";
import { chordFromEvent, chordId, parseChord, pressedChord } from "../../../lib/shortcuts/chord";
import { commandKeys, defaultKeys, setShortcutRecording, type ShortcutCommand } from "../../../lib/shortcuts/command";
import { conflictFor, isReservedChord } from "../../../lib/shortcuts/conflicts";
import { chordCaption, isDigitRow } from "../../../lib/shortcuts/format";
import { Button } from "../../ui/Button";
import { SettingItem } from "../SettingItem";

const isMac = IS_MACOS_RUNTIME;
const CAP = "rounded-md border border-chrome-neutral-800 bg-surface-container-high px-1.5 py-0.5 font-sans text-xs tabular-nums text-chrome-neutral-200";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const sameChord = (a: string, b: string) => {
  const left = parseChord(a);
  const right = parseChord(b);
  return !!left && !!right && chordId(pressedChord(left, isMac)) === chordId(pressedChord(right, isMac));
};

/** Which key is being recorded: a position in the list, or a new one at the end. */
type Recording = { at: number | "new" };
type Pending = { text: string; at: number | "new"; holder: ShortcutCommand<unknown> };

function nextKeys(keys: readonly string[], at: number | "new", text: string): string[] {
  const rest = keys.filter((key, index) => index !== at && !sameChord(key, text));
  if (at === "new") return [...rest, text];
  const kept = [...rest];
  kept.splice(Math.min(at, kept.length), 0, text);
  return kept;
}

/** Defaults are stored as no entry at all, so a later change to a default reaches this person too. */
function keysToSave(command: ShortcutCommand<unknown>, keys: readonly string[]): readonly string[] | null {
  const defaults = defaultKeys(command, isMac);
  return keys.length === defaults.length && keys.every((key, index) => key === defaults[index]) ? null : keys;
}

export function ShortcutEditRow({ command, overrides }: { command: ShortcutCommand<unknown>; overrides: ShortcutOverrides }) {
  const keys = commandKeys(command, isMac, overrides);
  const changed = overrides[command.id] !== undefined;
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = (next: ShortcutOverrides) => void saveOverrides(next);
  const commit = (base: ShortcutOverrides, at: number | "new", text: string) =>
    save(withCommandKeys(base, command.id, keysToSave(command, nextKeys(commandKeys(command, isMac, base), at, text))));
  // The key handler lives for one recording; it reads the bindings as they are when the key comes.
  const latest = useRef({ overrides, keys, commit });
  latest.current = { overrides, keys, commit };

  useEffect(() => {
    if (!recording) return;
    setShortcutRecording(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      if (plain && event.key === "Escape") {
        setRecording(null);
        return;
      }
      const { overrides, keys, commit } = latest.current;
      if (plain && (event.key === "Backspace" || event.key === "Delete")) {
        if (recording.at !== "new") {
          const at = recording.at;
          void saveOverrides(withCommandKeys(overrides, command.id, keysToSave(command, keys.filter((_, index) => index !== at))));
        }
        setRecording(null);
        return;
      }
      const text = chordFromEvent(event, isMac);
      if (!text) return;
      setRecording(null);
      if (isReservedChord(text, command.scope, isMac)) {
        setProblem(getString("settings_shortcut_reserved", chordCaption(text, isMac)));
        return;
      }
      const holder = conflictFor(command, text, isMac, overrides);
      if (holder?.fixed) {
        setProblem(getString("settings_shortcut_taken_fixed", chordCaption(text, isMac), getString(holder.label)));
      } else if (holder) {
        setPending({ text, at: recording.at, holder });
      } else {
        commit(overrides, recording.at, text);
      }
    };
    const onPointer = () => setRecording(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      setShortcutRecording(false);
    };
  }, [command, recording]);

  const record = (at: number | "new") => {
    setProblem(null);
    setPending(null);
    setRecording({ at });
  };

  const replace = () => {
    if (!pending) return;
    const holderKeys = commandKeys(pending.holder, isMac, overrides).filter((key) => !sameChord(key, pending.text));
    const holderDefaults = defaultKeys(pending.holder, isMac);
    const holderSame = holderKeys.length === holderDefaults.length && holderKeys.every((key, index) => key === holderDefaults[index]);
    commit(withCommandKeys(overrides, pending.holder.id, holderSame ? null : holderKeys), pending.at, pending.text);
    setPending(null);
  };

  const recordingLabel = getString("settings_shortcut_press_keys");
  const capFor = (text: string, index: number) => {
    const caption = chordCaption(text, isMac);
    if (command.fixed) return <kbd key={text} className={CAP}>{caption}</kbd>;
    const active = recording?.at === index;
    return (
      <button
        key={text}
        type="button"
        onClick={() => record(index)}
        aria-label={getString("settings_shortcut_change", caption)}
        className={`${CAP} transition-colors duration-200 ease-out hover:bg-surface-container-highest ${FOCUS} ${active ? "ring-2 ring-primary" : ""}`}
      >
        {active ? recordingLabel : caption}
      </button>
    );
  };

  return (
    <SettingItem title={getString(command.label)} description={problem ?? undefined}>
      <div className="flex flex-col items-end gap-2">
        {/* Key caps read left to right in every language, as they are printed on the keys. */}
        <div dir="ltr" className="flex flex-wrap items-center justify-end gap-1">
          {isDigitRow(keys) ? (
            <kbd className={CAP}>{getString("keyboard_key_digits")}</kbd>
          ) : (
            keys.map(capFor)
          )}
          {keys.length === 0 && recording?.at !== "new" && (
            <span className="text-xs text-chrome-neutral-500">{getString("settings_shortcut_not_set")}</span>
          )}
          {!command.fixed && (
            <button
              type="button"
              onClick={() => record("new")}
              aria-label={getString("settings_shortcut_add")}
              title={getString("settings_shortcut_add")}
              className={`grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 ${FOCUS} ${recording?.at === "new" ? "ring-2 ring-primary" : ""}`}
            >
              {recording?.at === "new" ? recordingLabel : <Plus size={14} />}
            </button>
          )}
          {changed && (
            <button
              type="button"
              onClick={() => save(withCommandKeys(overrides, command.id, null))}
              aria-label={getString("settings_shortcut_reset")}
              title={getString("settings_shortcut_reset")}
              className={`grid h-6 w-6 place-items-center rounded-md text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 ${FOCUS}`}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
        {pending && (
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-chrome-neutral-400">
            <span>{getString("settings_shortcut_taken", chordCaption(pending.text, isMac), getString(pending.holder.label))}</span>
            <Button size="sm" variant="tonal" onClick={() => setPending(null)}>
              {getString("cancel")}
            </Button>
            <Button size="sm" onClick={replace}>
              {getString("settings_shortcut_replace")}
            </Button>
          </div>
        )}
      </div>
    </SettingItem>
  );
}
