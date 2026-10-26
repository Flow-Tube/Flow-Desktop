type IconProps = { size?: number; className?: string };

export function OpenCollectiveIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path opacity="0.5" d="M21.865 5.166A12 12 0 0 1 21.865 18.834L18.756 15.725A7.714 7.714 0 0 0 18.756 8.275Z" />
      <path d="M18.834 2.135L15.725 5.244A7.714 7.714 0 1 0 15.725 18.756L18.834 21.865A12 12 0 1 1 18.834 2.135Z" />
    </svg>
  );
}

export function PatreonIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M14.82 2.41c3.96 0 7.18 3.24 7.18 7.21 0 3.96-3.22 7.18-7.18 7.18-3.97 0-7.21-3.22-7.21-7.18 0-3.97 3.24-7.21 7.21-7.21zM2 21.6h3.5V2.41H2V21.6z" />
    </svg>
  );
}
