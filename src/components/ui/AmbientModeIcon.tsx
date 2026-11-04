interface AmbientModeIconProps {
  size?: number;
  className?: string;
}

/** Android's ic_ambient_mode: a half-lit disc with a faint arc of light around it. */
export function AmbientModeIcon({ size = 18, className }: AmbientModeIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12,4C7.58,4 4,7.58 4,12C4,16.42 7.58,20 12,20C16.42,20 20,16.42 20,12C20,7.58 16.42,4 12,4ZM12,18V6C15.31,6 18,8.69 18,12C18,15.31 15.31,18 12,18Z" />
      <path
        fillOpacity={0.45}
        d="M12,1C11.45,1 11,1.45 11,2C11,2.55 11.45,3 12,3C16.97,3 21,7.03 21,12C21,16.97 16.97,21 12,21C11.45,21 11,21.45 11,22C11,22.55 11.45,23 12,23C18.08,23 23,18.08 23,12C23,5.92 18.08,1 12,1Z"
      />
    </svg>
  );
}
