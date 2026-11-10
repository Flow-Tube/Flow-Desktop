import type { SubtitleEdgeType } from "../store/usePlayerStore";

/** A theme-free color from the customizer, with its own opacity. */
export function colorWithOpacity(hex: string | undefined, opacity: number): string {
  const value = (hex || "#000000").replace("#", "");
  const r = parseInt(value.substring(0, 2), 16) || 0;
  const g = parseInt(value.substring(2, 4), 16) || 0;
  const b = parseInt(value.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** The text-shadow that draws an edge style, sized in em so it follows the caption size. */
export function captionEdgeShadow(type: SubtitleEdgeType, color: string): string | undefined {
  switch (type) {
    case "outline":
      return [
        `-0.05em -0.05em 0 ${color}`,
        `0.05em -0.05em 0 ${color}`,
        `-0.05em 0.05em 0 ${color}`,
        `0.05em 0.05em 0 ${color}`,
      ].join(", ");
    case "drop_shadow":
      return `0.06em 0.06em 0.12em ${color}`;
    case "raised":
      return `-0.05em -0.05em 0 ${color}`;
    case "depressed":
      return `0.05em 0.05em 0 ${color}`;
    default:
      return undefined;
  }
}

/** The list of cues whose text holds what was searched for, ignoring case. */
export function filterCues<T extends { text: string }>(cues: T[], query: string): T[] {
  const wanted = query.trim().toLocaleLowerCase();
  return wanted ? cues.filter((cue) => cue.text.toLocaleLowerCase().includes(wanted)) : cues;
}
