import React from "react";

import { LOGO_GLYPH_PATH, LOGO_SHAPE_PATH } from "../../lib/brand/logo";

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = "", size = 48, showText = false }) => {
  return (
    <div className={`flex items-center gap-1 select-none ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-300 hover:scale-105 active:scale-95 cursor-pointer"
      >
        {/* The Container (YouTube Shape) */}
        <path
          d={LOGO_SHAPE_PATH}
          className="fill-[var(--color-primary)]"
        />
        {/* The "F" Symbol (Slanted for Speed) */}
        <path
          d={LOGO_GLYPH_PATH}
          className="fill-[var(--color-on-primary)]"
        />
      </svg>
      {showText && (
        <span className="font-extrabold text-xl tracking-tight text-chrome-neutral-100">
          Flow
        </span>
      )}
    </div>
  );
};

export default Logo;
