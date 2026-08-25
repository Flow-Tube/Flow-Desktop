import { getCurrentWindow } from "@tauri-apps/api/window";

// Undecorated windows lose the native resize borders, so we recreate them with
// thin hit-areas that hand the drag off to the OS. Shared by every undecorated
// Flow window: the main frame and the pop-out mini player.
const RESIZE_EDGES = [
  { dir: "North", cls: "top-0 inset-x-0 h-[3px] cursor-ns-resize" },
  { dir: "South", cls: "bottom-0 inset-x-0 h-[3px] cursor-ns-resize" },
  { dir: "West", cls: "inset-y-0 left-0 w-[3px] cursor-ew-resize" },
  { dir: "East", cls: "inset-y-0 right-0 w-[3px] cursor-ew-resize" },
  { dir: "NorthWest", cls: "top-0 left-0 h-2.5 w-2.5 cursor-nwse-resize" },
  { dir: "NorthEast", cls: "top-0 right-0 h-2.5 w-2.5 cursor-nesw-resize" },
  { dir: "SouthWest", cls: "bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize" },
  { dir: "SouthEast", cls: "bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize" },
] as const;

export function WindowResizeEdges({ zIndexClass = "z-[200]" }: { zIndexClass?: string }) {
  return (
    <>
      {RESIZE_EDGES.map((edge) => (
        <div
          key={edge.dir}
          className={`fixed ${zIndexClass} ${edge.cls}`}
          onMouseDown={() => {
            try {
              void getCurrentWindow().startResizeDragging(edge.dir).catch(() => {});
            } catch {
              // Not running under Tauri (tests / plain vite preview).
            }
          }}
        />
      ))}
    </>
  );
}
