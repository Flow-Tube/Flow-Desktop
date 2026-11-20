import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";

import { listenForZoomInput } from "../../lib/gestures/pinch";
import { pinchColumns } from "../../lib/gestures/pinchGrid";
import { useTrackpadGesturesEnabled } from "../../lib/gestures/trackpadGestures";
import { getString } from "../../lib/i18n/index";
import { SETTINGS } from "../../lib/settings/schema";
import { GRID_COLUMNS_DEFAULT } from "../../lib/useGridColumns";
import { useAppSettingsStore } from "../../store/useAppSettingsStore";

const HINT_MS = 900;

const gridColumns = () => {
  const columns = Number(useAppSettingsStore.getState().values[SETTINGS.GRID_COLUMNS]);
  return Number.isFinite(columns) && columns > 0 ? columns : GRID_COLUMNS_DEFAULT;
};

/**
 * A pinch over a feed changes how many thumbnails share a row, as in Photos. Anywhere else a pinch or
 * Ctrl and the wheel does nothing, rather than zooming the whole page as WebView2 would. The player
 * takes its own pinches first.
 */
export function PinchGridHost() {
  const enabled = useTrackpadGesturesEnabled();
  const [hint, setHint] = useState<{ id: number; columns: number } | null>(null);

  useEffect(() => {
    let scale = 1;
    return listenForZoomInput(window, ({ factor, clientX, clientY }) => {
      if (!enabled) return true;
      const over = Number.isFinite(clientX) && Number.isFinite(clientY) ? document.elementFromPoint(clientX, clientY) : null;
      if (!over?.closest(".flow-grid") || over.closest("#flow-player-root")) {
        scale = 1;
        return true;
      }
      const columns = gridColumns();
      const next = pinchColumns(columns, scale * factor);
      scale = next.scale;
      if (next.columns !== columns) {
        void useAppSettingsStore.getState().setSettingValue(SETTINGS.GRID_COLUMNS, String(next.columns));
        setHint((current) => ({ id: (current?.id ?? 0) + 1, columns: next.columns }));
      }
      return true;
    });
  }, [enabled]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  if (!hint) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-full border border-chrome-neutral-800 bg-surface-container px-4 py-2 text-sm font-medium tabular-nums text-chrome-neutral-100 animate-fade-in"
    >
      <LayoutGrid size={16} />
      {getString("grid_columns_hint", hint.columns)}
    </div>
  );
}

