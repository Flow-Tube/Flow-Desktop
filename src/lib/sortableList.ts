import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";

export function useListDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** Translate only: CSS.Transform also scales, stretching a row to its neighbour's size. */
export const sortableRowStyle = (
  transform: Transform | null,
  transition: string | undefined,
) => ({
  transform: CSS.Translate.toString(transform),
  transition,
});

/** Resolve a drag-end event to `[fromIndex, toIndex]` within `ids`, or null. */
export function resolveDragMove(
  event: DragEndEvent,
  ids: string[],
): [number, number] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const from = ids.indexOf(String(active.id));
  const to = ids.indexOf(String(over.id));
  if (from < 0 || to < 0) return null;
  return [from, to];
}
