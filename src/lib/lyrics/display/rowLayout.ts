import type { LyricsEntry } from "../types";
import type { LyricsListItem } from "./model";
import { adaptiveLyricsTextSize } from "./model";
import type { LyricsPresentation } from "./presentation";
import { layoutText, type TextBlock, type TextMeasurer } from "./textLayout";

/** Sizes from Android's LyricsLine and IntervalIndicator, in CSS px for dp. */
export const ACTIVE_SCALE = 1.05;
export const INACTIVE_SCALE = 0.92;
export const ROW_PADDING_X = 24;
export const ROW_PADDING_Y = 12;
const BACKGROUND_PADDING_BOTTOM = 2;
export const INDICATOR_HEIGHT = 64;
export const ROMANIZATION_GAP = 6;
export const TRANSLATION_GAP = 7;
const LYRIC_WEIGHT = 700;
const SECONDARY_WEIGHT = 600;

export interface LineLayout {
  kind: "line";
  /** The width the text column gets: narrow enough that the active line's scale stays in the row. */
  columnWidth: number;
  mainText: string;
  textSize: number;
  main: TextBlock;
  romanization: TextBlock | null;
  translation: TextBlock | null;
  paddingTop: number;
  paddingBottom: number;
  height: number;
}

export type RowLayout = LineLayout | { kind: "indicator"; height: number };

/** A background line's text without the parentheses its source wraps it in. */
export const mainTextOf = (entry: LyricsEntry): string =>
  entry.isBackground ? entry.text.replace(/^\(/, "").replace(/\)$/, "") : entry.text;

export function layoutRows(
  items: LyricsListItem[],
  presentation: LyricsPresentation,
  rowWidth: number,
  family: string,
  measurer: TextMeasurer,
): RowLayout[] {
  const columnWidth = Math.max(1, (rowWidth - ROW_PADDING_X * 2) / ACTIVE_SCALE);
  return items.map((item) => {
    if (item.kind === "indicator") return { kind: "indicator", height: INDICATOR_HEIGHT };
    const { entry, index } = item;
    const look = presentation.looks[index]!;
    const isBackground = !!entry.isBackground;
    const mainText = mainTextOf(entry);
    const textSize = adaptiveLyricsTextSize(look.textSize, mainText.length, isBackground);
    const main = layoutText(
      mainText,
      { size: textSize, weight: LYRIC_WEIGHT, italic: isBackground, family, lineSpacing: look.lineSpacing },
      columnWidth,
      measurer,
    );
    const secondarySize = Math.max(textSize * 0.52, 15);
    const secondaryLine = Math.max(textSize * 0.68, 19);
    const secondary = (text: string, italic: boolean) =>
      layoutText(
        text,
        { size: secondarySize, weight: SECONDARY_WEIGHT, italic, family, lineSpacing: secondaryLine / secondarySize },
        columnWidth,
        measurer,
      );
    const romanizationText = presentation.romanizations[index];
    const translationText = presentation.showTranslation && entry.translation?.trim() ? entry.translation : null;
    const romanization = romanizationText ? secondary(romanizationText, true) : null;
    const translation = translationText ? secondary(translationText, false) : null;
    const paddingTop = isBackground ? 0 : ROW_PADDING_Y;
    const paddingBottom = isBackground ? BACKGROUND_PADDING_BOTTOM : ROW_PADDING_Y;
    const height =
      paddingTop +
      main.height +
      (romanization ? ROMANIZATION_GAP + romanization.height : 0) +
      (translation ? TRANSLATION_GAP + translation.height : 0) +
      paddingBottom;
    return { kind: "line", columnWidth, mainText, textSize, main, romanization, translation, paddingTop, paddingBottom, height };
  });
}
