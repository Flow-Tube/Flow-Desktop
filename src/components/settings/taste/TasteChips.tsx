import type { KeyboardEvent } from "react";
import { Ban, Check, Heart, Loader2, Plus, X } from "lucide-react";

import { TextInput } from "../../ui/TextInput";
import { getString } from "../../../lib/i18n/index";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function submitOnEnter(event: KeyboardEvent<HTMLInputElement>, submit: () => void) {
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
  }
}

interface TopicChipProps {
  topic: string;
  active?: boolean;
  blocked?: boolean;
  saving?: boolean;
  onClick: () => void;
}

export function TopicChip({ topic, active, blocked, saving, onClick }: TopicChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={cx(
        "inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ease-out disabled:cursor-wait disabled:opacity-60",
        active
          ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
          : blocked
            ? "border border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400 hover:bg-chrome-red-950/50"
            : "border border-chrome-neutral-700 bg-transparent text-chrome-neutral-300 hover:bg-chrome-neutral-800 hover:text-chrome-neutral-100",
      )}
    >
      {saving ? (
        <Loader2 size={15} className="animate-spin" />
      ) : active ? (
        <Check size={15} />
      ) : blocked ? (
        <Ban size={15} />
      ) : null}
      <span>{topic}</span>
    </button>
  );
}

interface RemovableChipProps {
  topic: string;
  /** A second, quieter line, e.g. how often the topic was watched. */
  detail?: string;
  tone: "interest" | "blocked";
  saving?: boolean;
  onRemove: () => void;
}

export function RemovableChip({ topic, detail, tone, saving, onRemove }: RemovableChipProps) {
  return (
    <span
      className={cx(
        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
        tone === "interest"
          ? "border-chrome-neutral-700 bg-surface-container-high text-chrome-neutral-200"
          : "border-chrome-red-900/50 bg-chrome-red-950/30 text-chrome-red-400",
      )}
    >
      {tone === "interest" ? <Heart size={14} /> : <Ban size={14} />}
      <span>{topic}</span>
      {detail && <span className="text-xs text-chrome-neutral-500">{detail}</span>}
      <button
        type="button"
        onClick={onRemove}
        disabled={saving}
        className="grid h-6 w-6 place-items-center rounded-full text-current transition-colors duration-200 ease-out hover:bg-chrome-neutral-800 disabled:cursor-wait disabled:opacity-60"
        title={getString(tone === "interest" ? "taste_remove_interest" : "taste_unblock_topic")}
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <X size={14} />}
      </button>
    </span>
  );
}

interface AddTopicFormProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  buttonLabel: string;
  onSubmit: () => void;
  disabled?: boolean;
}

export function AddTopicForm({
  value,
  onChange,
  placeholder,
  buttonLabel,
  onSubmit,
  disabled,
}: AddTopicFormProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <TextInput
        value={value}
        onChange={onChange}
        onKeyDown={(event) => submitOnEnter(event, onSubmit)}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-lg"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-on-primary)] transition-colors duration-200 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={16} />
        {buttonLabel}
      </button>
    </div>
  );
}
