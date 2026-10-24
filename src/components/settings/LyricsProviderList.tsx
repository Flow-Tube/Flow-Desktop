import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';

import { ToggleSwitch } from '../ui/ToggleSwitch';
import { getString } from '../../lib/i18n/index';

export interface LyricsProviderListProps {
  /** Provider names in the order they are tried. */
  order: string[];
  isEnabled: (name: string) => boolean;
  onReorder: (order: string[]) => void;
  onToggle: (name: string, enabled: boolean) => void;
}

const MOVE_BTN =
  'grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors duration-200 ease-out hover:bg-surface-container-high hover:text-chrome-neutral-100 disabled:pointer-events-none disabled:opacity-30';

interface RowProps {
  name: string;
  index: number;
  count: number;
  enabled: boolean;
  onMove: (from: number, to: number) => void;
  onToggle: (name: string, enabled: boolean) => void;
}

function ProviderRow({ name, index, count, enabled, onMove, onToggle }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: name });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 px-3 py-3 transition-colors duration-200 ease-out ${
        isDragging ? 'relative z-10 bg-surface-container-high' : 'hover:bg-surface-container'
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={getString('settings_lyrics_provider_drag', name)}
        className="grid h-8 w-8 cursor-grab touch-none place-items-center rounded-full text-chrome-neutral-500 hover:text-chrome-neutral-200 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-chrome-neutral-200">{`${index + 1}. ${name}`}</div>
        <div className="mt-0.5 text-xs text-chrome-neutral-400">
          {getString(enabled ? 'settings_lyrics_provider_enabled' : 'settings_lyrics_provider_disabled')}
        </div>
      </div>
      <button
        type="button"
        className={MOVE_BTN}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        aria-label={getString('settings_lyrics_provider_move_up', name)}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={MOVE_BTN}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        aria-label={getString('settings_lyrics_provider_move_down', name)}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="ml-2 shrink-0">
        <ToggleSwitch checked={enabled} onChange={(next) => onToggle(name, next)} />
      </div>
    </div>
  );
}

/** Lyrics providers in lookup order: drag a row, or move it with the arrow buttons. */
export function LyricsProviderList({ order, isEnabled, onReorder, onToggle }: LyricsProviderListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    onReorder(arrayMove(order, from, to));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(order.indexOf(String(active.id)), order.indexOf(String(over.id)));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div role="list" aria-label={getString('settings_lyrics_providers')} className="flex flex-col divide-y divide-chrome-neutral-800/50">
          {order.map((name, index) => (
            <div role="listitem" key={name}>
              <ProviderRow
                name={name}
                index={index}
                count={order.length}
                enabled={isEnabled(name)}
                onMove={move}
                onToggle={onToggle}
              />
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
