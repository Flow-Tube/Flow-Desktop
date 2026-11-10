import { useState, type FormEvent } from "react";
import { getString } from "../../lib/i18n/index";
import { Button } from "../ui/Button";

const FIELD_CLASS =
  "w-full rounded-lg border border-chrome-neutral-800 bg-surface-container-low px-4 py-2.5 text-sm font-medium text-chrome-neutral-100 outline-none transition-colors placeholder:text-chrome-neutral-500 focus:border-chrome-neutral-700";
const LABEL_CLASS = "text-xs font-semibold text-chrome-neutral-500";

interface PlaylistFormDialogProps {
  title: string;
  confirmLabel: string;
  initialName?: string;
  initialDescription?: string;
  onSubmit: (name: string, description: string) => void | Promise<void>;
  onCancel: () => void;
}

/** A playlist's name and description, for making one or editing one. */
export function PlaylistFormDialog({
  title,
  confirmLabel,
  initialName = "",
  initialDescription = "",
  onSubmit,
  onCancel,
}: PlaylistFormDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void onSubmit(name, description);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-chrome-black/70 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <h3 className="text-lg font-medium text-chrome-neutral-100">{title}</h3>

        <div className="space-y-1">
          <label htmlFor="playlist-form-name" className={LABEL_CLASS}>{getString("playlists_playlist_name")}</label>
          <input
            id="playlist-form-name"
            type="text"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={getString("playlist_name_placeholder")}
            className={FIELD_CLASS}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="playlist-form-description" className={LABEL_CLASS}>{getString("playlist_description_optional")}</label>
          <textarea
            id="playlist-form-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={getString("albums_desc_placeholder")}
            rows={3}
            className={`${FIELD_CLASS} resize-none`}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {getString("cancel")}
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
