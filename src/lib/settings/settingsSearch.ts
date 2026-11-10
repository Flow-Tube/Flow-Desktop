import { getString } from "../i18n/index";
import { foldForSearch } from "../musicVideoMatching";
import { SETTINGS_CATEGORY_LABELS, type SettingEntry } from "./settingsIndex";

const TITLE_PREFIX = 100;
const TITLE_WORD_PREFIX = 80;
const TITLE_CONTAINS = 60;
const KEYWORD_PREFIX = 55;
const KEYWORD_CONTAINS = 40;
const SUMMARY_CONTAINS = 25;
const PAGE_CONTAINS = 15;

const WORD_SPLIT = /[\s\p{P}]+/u;

interface Searchable {
  entry: SettingEntry;
  title: string;
  summary: string;
  keywords: string[];
  page: string;
}

function wordScore(word: string, { title, summary, keywords, page }: Searchable): number | null {
  if (title.startsWith(word)) return TITLE_PREFIX;
  if (title.split(WORD_SPLIT).some((part) => part.startsWith(word))) return TITLE_WORD_PREFIX;
  if (title.includes(word)) return TITLE_CONTAINS;
  if (keywords.some((keyword) => keyword.startsWith(word))) return KEYWORD_PREFIX;
  if (keywords.some((keyword) => keyword.includes(word))) return KEYWORD_CONTAINS;
  if (summary.includes(word)) return SUMMARY_CONTAINS;
  if (page.includes(word)) return PAGE_CONTAINS;
  return null;
}

/**
 * Ranks settings against a query, as Flow for Android does. Every word has to match somewhere; a
 * match in the title outranks a keyword, which outranks the summary, which outranks the page name.
 */
export function searchSettings(query: string, entries: SettingEntry[]): SettingEntry[] {
  const words = foldForSearch(query).split(WORD_SPLIT).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { entry: SettingEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const searchable: Searchable = {
      entry,
      title: foldForSearch(getString(entry.title)),
      summary: entry.summary ? foldForSearch(getString(entry.summary)) : "",
      keywords: (entry.keywords ?? []).map(foldForSearch),
      page: foldForSearch(getString(SETTINGS_CATEGORY_LABELS[entry.category])),
    };
    let score = 0;
    for (const word of words) {
      const points = wordScore(word, searchable);
      if (points === null) return;
      score += points;
    }
    scored.push({ entry, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(({ entry }) => entry);
}
