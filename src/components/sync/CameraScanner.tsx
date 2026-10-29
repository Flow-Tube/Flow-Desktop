import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { X } from "lucide-react";

import { getString } from "../../lib/i18n/index";


export function CameraScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserQRCodeReader();
    (async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (result && !cancelled) {
            controlsRef.current?.stop();
            onResult(result.getText());
          }
        });
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (!cancelled) setError(getString("sync_camera_error"));
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, [onResult]);

  return (
    <div className="mt-6 space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-chrome-neutral-800 bg-chrome-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-chrome-white/70" />
      </div>
      {error && <p className="text-sm text-chrome-red-400">{error}</p>}
      <button
        type="button"
        onClick={onClose}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-surface-container-high py-2.5 text-sm font-medium text-chrome-neutral-200 transition-colors hover:bg-surface-container-highest"
      >
        <X className="h-4 w-4" /> {getString("sync_stop_camera")}
      </button>
    </div>
  );
}
