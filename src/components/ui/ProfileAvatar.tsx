// A profile's avatar: a photo, an emoji, or the first letter of its name, on one of the eight
// profile colours. Blank or unknown colours use the theme's own accent.

const COLOR_CLASSES: Record<string, string> = {
  blue: "bg-profile-blue-container text-profile-blue-content",
  teal: "bg-profile-teal-container text-profile-teal-content",
  green: "bg-profile-green-container text-profile-green-content",
  amber: "bg-profile-amber-container text-profile-amber-content",
  orange: "bg-profile-orange-container text-profile-orange-content",
  red: "bg-profile-red-container text-profile-red-content",
  pink: "bg-profile-pink-container text-profile-pink-content",
  purple: "bg-profile-purple-container text-profile-purple-content",
};
const ACCENT_CLASSES = "bg-surface-container-high text-[var(--color-primary)]";

const SIZE_CLASSES = {
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
  xl: "h-16 w-16 text-2xl",
} as const;

export type ProfileAvatarSize = keyof typeof SIZE_CLASSES;

export function profileColorClasses(colorKey: string): string {
  return COLOR_CLASSES[colorKey] ?? ACCENT_CLASSES;
}

// Not in this project's TypeScript lib yet; every webview Flow runs in has it.
type GraphemeSegmenter = new () => { segment(text: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;

/** The first character of the name as a person reads it (an emoji or accented letter stays whole). */
export function profileInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const first = Segmenter
    ? new Segmenter().segment(trimmed)[Symbol.iterator]().next().value?.segment
    : Array.from(trimmed)[0];
  return (first ?? "").toLocaleUpperCase();
}

export interface ProfileAvatarProps {
  name: string;
  colorKey: string;
  kind: string;
  emoji?: string;
  /** A ready-to-show image source for a photo avatar. */
  photoSrc?: string | null;
  size?: ProfileAvatarSize;
  className?: string;
}

export function ProfileAvatar({ name, colorKey, kind, emoji, photoSrc, size = "md", className = "" }: ProfileAvatarProps) {
  const base = `inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none ${SIZE_CLASSES[size]} ${profileColorClasses(colorKey)} ${className}`;
  if (kind === "photo" && photoSrc) {
    return (
      <span className={base} aria-hidden="true">
        <img src={photoSrc} alt="" className="h-full w-full object-cover" draggable={false} />
      </span>
    );
  }
  const glyph = kind === "emoji" && emoji ? emoji : profileInitial(name);
  return (
    <span className={base} aria-hidden="true">
      {glyph}
    </span>
  );
}
