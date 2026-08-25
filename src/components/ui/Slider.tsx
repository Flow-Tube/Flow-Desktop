import { useState, type CSSProperties } from 'react';
import { useExpressiveSliders } from '../../lib/useExpressiveSliders';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

/**
 * Material 3 Expressive slider: thick track, thin handle, gap between them.
 * Falls back to the plain native control when the Settings toggle is off.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  className = '',
  orientation = 'horizontal',
  'aria-label': ariaLabel,
}: SliderProps) {
  const [pressed, setPressed] = useState(false);
  const expressive = useExpressiveSliders();
  const vertical = orientation === 'vertical';

  const range = max - min;
  const fill = range > 0 ? Math.min(1, Math.max(0, (value - min) / range)) : 0;

  const input = (
    <input
      className={expressive ? 'm3-slider__input' : `m3-slider-legacy ${vertical ? 'm3-slider-legacy--vertical' : ''} ${className}`}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onBlur={() => setPressed(false)}
    />
  );

  if (!expressive) return input;

  return (
    <div
      className={`m3-slider ${vertical ? 'm3-slider--vertical' : ''} ${className}`}
      data-pressed={pressed && !disabled}
      data-disabled={Boolean(disabled)}
      style={{ '--m3-fill': fill } as CSSProperties}
    >
      <span className="m3-slider__track m3-slider__track--active" />
      <span className="m3-slider__track m3-slider__track--inactive" />
      {/* Once the handle covers the end of travel the stop indicator is noise. */}
      {fill < 0.97 && <span className="m3-slider__stop" />}
      <span className="m3-slider__handle" />
      {input}
    </div>
  );
}
