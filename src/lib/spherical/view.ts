/** Where a 360 video is looked at: yaw and pitch in degrees, and the vertical field of view. */
export interface LookAt {
  yaw: number;
  pitch: number;
  fov: number;
}

export type Projection = "equirectangular" | "equirectangular_top_bottom";

export const DEFAULT_FOV = 90;
export const MIN_FOV = 30;
export const MAX_FOV = 110;
/** The look-around speeds Android offers. */
export const LOOK_SPEEDS = [1, 1.5, 2, 3] as const;
// A drag across the whole player turns the view by about its own width at speed 1.
const DEGREES_PER_PX = 0.12;
const KEY_STEP_DEGREES = 5;
const ZOOM_PER_WHEEL_PX = 0.05;

export const initialLook = (): LookAt => ({ yaw: 0, pitch: 0, fov: DEFAULT_FOV });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/**
 * A drag of `dx`, `dy` CSS px moves the picture with the pointer, as a hand would. Zoomed in, the
 * same drag turns less, so the picture still keeps up with the pointer.
 */
export function dragLook(look: LookAt, dx: number, dy: number, speed: number): LookAt {
  const scale = DEGREES_PER_PX * speed * (look.fov / DEFAULT_FOV);
  return { ...look, yaw: wrap(look.yaw - dx * scale), pitch: clamp(look.pitch + dy * scale, -89, 89) };
}

/** The wheel zooms: down widens the view, up narrows it. */
export function zoomLook(look: LookAt, deltaY: number): LookAt {
  return { ...look, fov: clamp(look.fov + deltaY * ZOOM_PER_WHEEL_PX, MIN_FOV, MAX_FOV) };
}

/** W, A, S and D look around, as on YouTube; anything else is not a look key. */
export function keyLook(look: LookAt, key: string, speed: number): LookAt | null {
  const step = KEY_STEP_DEGREES * speed;
  switch (key.toLowerCase()) {
    case "a":
      return { ...look, yaw: wrap(look.yaw - step) };
    case "d":
      return { ...look, yaw: wrap(look.yaw + step) };
    case "w":
      return { ...look, pitch: clamp(look.pitch + step, -89, 89) };
    case "s":
      return { ...look, pitch: clamp(look.pitch - step, -89, 89) };
    default:
      return null;
  }
}
