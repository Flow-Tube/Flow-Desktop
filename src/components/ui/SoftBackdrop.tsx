import { useEffect, useRef } from 'react';

/** Pixel size of the canvas the browser stretches over the element. */
const CANVAS_SIZE = 48;

export interface SoftBackdropProps {
  src: string;
  className?: string;
  /**
   * How many pixels across the image is reduced to before it is scaled back up.
   * Fewer pixels give a softer result: 8 is a full-screen glow, 24 a card's.
   */
  detail?: number;
  saturate?: boolean;
  onError?: () => void;
}

/**
 * A blurred copy of an image without a CSS blur filter. The image is drawn once
 * into a tiny canvas that the browser stretches with smoothing, so a repaint
 * costs a scaled copy instead of re-blurring the whole area, which WebKitGTK
 * does on the CPU (WebKit bug 240865). Drawing a cross-origin image taints the
 * canvas but still shows it, so no CORS is needed.
 */
export function SoftBackdrop({ src, className = '', detail = 10, saturate = false, onError }: SoftBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!cancelled) paintSoft(canvas, image, detail, saturate);
    };
    image.onerror = () => {
      if (!cancelled) onErrorRef.current?.();
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, detail, saturate]);

  return <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} aria-hidden="true" className={className} />;
}

function paintSoft(canvas: HTMLCanvasElement, image: HTMLImageElement, detail: number, saturate: boolean) {
  const small = document.createElement('canvas');
  small.width = detail;
  small.height = detail;
  const smallContext = small.getContext('2d');
  const context = canvas.getContext('2d');
  if (!smallContext || !context) return;

  // Centre square of the image, like object-cover on a square box.
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  smallContext.imageSmoothingQuality = 'high';
  smallContext.drawImage(image, sx, sy, side, side, 0, 0, detail, detail);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  // Ignored where canvas filters are unsupported; the blur doesn't depend on it.
  context.filter = saturate ? 'saturate(150%)' : 'none';
  context.drawImage(small, 0, 0, canvas.width, canvas.height);
}
