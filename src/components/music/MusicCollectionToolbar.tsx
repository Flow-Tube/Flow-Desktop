import { CheckSquare, Download, ListEnd, ListPlus, ListChecks, MinusCircle, Play, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { getPlural, getString } from '../../lib/i18n/index';
import { musicSortLabel, type MusicSortOrder } from '../../lib/musicCollectionSort';
import { SearchInput } from '../ui/SearchInput';
import { Select } from '../ui/Select';

function ToolbarButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded-full bg-surface-container-high px-3 text-sm font-medium text-chrome-neutral-200 transition-colors duration-200 ease-out hover:bg-surface-container-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

export interface CollectionSelectionBarProps {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDone: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToAlbum: () => void;
  onDownload: () => void;
  onRemove?: () => void;
}

/** What a selection offers. Removing is there only on your own lists. */
export function CollectionSelectionBar({
  count,
  allSelected,
  onToggleAll,
  onDone,
  onPlayNext,
  onAddToQueue,
  onAddToAlbum,
  onDownload,
  onRemove,
}: CollectionSelectionBarProps) {
  const none = count === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onDone}
        aria-label={getString('music_collection_done')}
        title={getString('music_collection_done')}
        className="grid h-9 w-9 place-items-center rounded-full text-chrome-neutral-300 transition-colors duration-200 ease-out hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" />
      </button>
      <span className="me-2 text-sm font-medium tabular-nums text-chrome-neutral-100">
        {getPlural('music_selected_count', count)}
      </span>
      <ToolbarButton
        label={getString(allSelected ? 'music_collection_deselect_all' : 'music_collection_select_all')}
        icon={allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
        onClick={onToggleAll}
      />
      <ToolbarButton label={getString('music_play_next')} icon={<Play className="h-4 w-4" />} disabled={none} onClick={onPlayNext} />
      <ToolbarButton label={getString('music_add_to_queue')} icon={<ListEnd className="h-4 w-4" />} disabled={none} onClick={onAddToQueue} />
      <ToolbarButton label={getString('music_add_to_album')} icon={<ListPlus className="h-4 w-4" />} disabled={none} onClick={onAddToAlbum} />
      <ToolbarButton label={getString('music_download')} icon={<Download className="h-4 w-4" />} disabled={none} onClick={onDownload} />
      {onRemove ? (
        <ToolbarButton label={getString('remove')} icon={<MinusCircle className="h-4 w-4" />} disabled={none} onClick={onRemove} />
      ) : null}
    </div>
  );
}

export interface CollectionFilterBarProps {
  isAlbumKind: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  sortOrder: MusicSortOrder;
  sortOrders: MusicSortOrder[];
  onSortChange: (order: MusicSortOrder) => void;
  onSelect: () => void;
}

/** Search, order and the way into selecting songs. */
export function CollectionFilterBar({
  isAlbumKind,
  query,
  onQueryChange,
  sortOrder,
  sortOrders,
  onSortChange,
  onSelect,
}: CollectionFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={getString('music_collection_search')}
        aria-label={getString('music_collection_search')}
        containerClassName="w-full max-w-xs"
      />
      <Select
        value={sortOrder}
        onChange={(value) => onSortChange(value as MusicSortOrder)}
        options={sortOrders.map((order) => ({ value: order, label: musicSortLabel(order, isAlbumKind) }))}
        className="w-52"
      />
      <ToolbarButton label={getString('music_collection_select')} icon={<ListChecks className="h-4 w-4" />} onClick={onSelect} />
    </div>
  );
}
