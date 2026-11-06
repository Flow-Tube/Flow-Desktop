import { useState, type FormEvent } from 'react';

import { getString } from '../../lib/i18n/index';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/TextInput';

interface EditAlbumDialogProps {
  initialTitle: string;
  initialDescription: string;
  onSave: (title: string, description: string) => void;
  onClose: () => void;
}

/** Name and description of one of your own lists. */
export function EditAlbumDialog({ initialTitle, initialDescription, onSave, onClose }: EditAlbumDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave(title, description);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-chrome-black/70 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <h3 className="text-lg font-medium text-chrome-neutral-100">{getString('album_edit')}</h3>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-chrome-neutral-500">{getString('albums_name_label')}</span>
          <TextInput autoFocus value={title} onChange={setTitle} className="w-full" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-chrome-neutral-500">{getString('albums_desc_label')}</span>
          <TextInput
            value={description}
            onChange={setDescription}
            className="w-full"
            placeholder={getString('albums_desc_placeholder')}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {getString('cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim()}>
            {getString('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
