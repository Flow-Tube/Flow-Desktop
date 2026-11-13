import type { CSSProperties } from "react";

export const LOGO_ASPECT = 48 / 36;

export const LOGO_CONTAINER_PATH =
  "M21.58 7.16C21.33 6.22 20.59 5.48 19.65 5.23C17.96 4.77 12 4.77 12 4.77C12 4.77 6.04 4.77 4.35 5.23C3.41 5.48 2.67 6.22 2.42 7.16C1.96 8.85 1.96 12.38 1.96 12.38C1.96 12.38 1.96 15.91 2.42 17.6C2.67 18.54 3.41 19.28 4.35 19.53C6.04 19.99 12 19.99 12 19.99C12 19.99 17.96 19.99 19.65 19.53C20.59 19.28 21.33 18.54 21.58 17.6C22.04 15.91 22.04 12.38 22.04 12.38C22.04 12.38 22.04 8.85 21.58 7.16Z";

export const LOGO_GLYPH_PATH =
  "M10 7L18 7L17.2 9.5H12.8L12.2 11.5H16L15.2 14H11.5L10.5 17H7.5L10 7Z";

export interface FlowLogoProps {
  width?: number;
  height?: number;
  shapeColor?: string;
  glyphColor?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The official Flow app badge, drawn in theme/card colours so it follows every palette.
 * Matches Android FlowLogo composable.
 */
export function FlowLogo({
  width = 28,
  height,
  shapeColor = "var(--color-primary, #FF0000)",
  glyphColor = "var(--color-on-primary, #FFFFFF)",
  className = "",
  style,
}: FlowLogoProps) {
  const actualHeight = height ?? Math.round(width / LOGO_ASPECT);

  return (
    <svg
      width={width}
      height={actualHeight}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      style={style}
      aria-label="Flow"
    >
      <path d={LOGO_CONTAINER_PATH} fill={shapeColor} />
      <path d={LOGO_GLYPH_PATH} fill={glyphColor} />
    </svg>
  );
}
