/** The text the user has highlighted, trimmed, or "" when nothing is highlighted. */
export function selectedText(selection: Selection | null = window.getSelection()): string {
  if (!selection || selection.isCollapsed) return "";
  return selection.toString().trim();
}

/**
 * Whether text is highlighted right now. A click that ends a drag-select fires on
 * the element under the pointer, so a clickable block of text checks this first
 * and leaves the highlight alone instead of acting on that click.
 */
export function hasTextSelection(selection: Selection | null = window.getSelection()): boolean {
  return selectedText(selection) !== "";
}

/** Whether the highlighted text touches `node`, such as a list the user is copying from. */
export function selectionTouches(node: Node | null, selection: Selection | null = window.getSelection()): boolean {
  if (!node || !hasTextSelection(selection)) return false;
  for (let index = 0; index < selection!.rangeCount; index += 1) {
    if (selection!.getRangeAt(index).intersectsNode(node)) return true;
  }
  return false;
}

const SEARCH_QUERY_LIMIT = 100;

/** A highlighted passage as a search query: one line, whitespace collapsed, capped in length. */
export function selectionSearchQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_LIMIT).trim();
}

const LABEL_LIMIT = 30;

/** A query short enough to quote inside a menu label. */
export function shortSelectionLabel(query: string): string {
  return query.length > LABEL_LIMIT ? `${query.slice(0, LABEL_LIMIT).trimEnd()}…` : query;
}
