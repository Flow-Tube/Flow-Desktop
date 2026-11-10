import { profileStorage } from '../storage/profileStorage';
import strings from './strings.json';

export type StringKey = keyof typeof strings;

/** Where the language choice is kept for the next start: settings aren't readable before the first render. */
export const APP_LANGUAGE_STORAGE_KEY = 'flow_app_language';

const RIGHT_TO_LEFT = new Set(['ar', 'fa', 'ur']);

const localeLoaders = import.meta.glob<Record<string, string>>('./locales/*.json', { import: 'default' });

/** The language the interface is written in. */
export let APP_LOCALE = 'en';
let translations: Record<string, string> = {};
let pluralRules = new Intl.PluralRules(APP_LOCALE);

/** Every language with a translation file, by tag. */
export const APP_LANGUAGES = Object.keys(localeLoaders)
  .map((path) => path.slice('./locales/'.length, -'.json'.length))
  .sort();

/** Loads the chosen language, before anything reads a string. Unknown or unreadable means English. */
export async function initAppLanguage(): Promise<void> {
  let tag: string | null = null;
  try {
    tag = profileStorage.getItem(APP_LANGUAGE_STORAGE_KEY, 'device');
  } catch {
    tag = null;
  }
  const load = tag ? localeLoaders[`./locales/${tag}.json`] : undefined;
  if (!tag || !load) return;
  try {
    translations = await load();
  } catch (error) {
    console.error('Failed to load the language', tag, error);
    return;
  }
  APP_LOCALE = tag;
  pluralRules = new Intl.PluralRules(tag);
  document.documentElement.lang = tag;
  document.documentElement.dir = RIGHT_TO_LEFT.has(tag.split('-')[0]!) ? 'rtl' : 'ltr';
}

/** A string with `%s`, `%d` or positional `%1$s` placeholders filled in. Untranslated text stays English. */
export function getString(key: StringKey, ...args: unknown[]): string {
  const template = translations[key] ?? ((strings[key] as string) || String(key));
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?[sd]/g, (placeholder, position?: string) => {
    const index = position ? Number(position) - 1 : next++;
    return index < args.length ? String(args[index]) : placeholder;
  });
}

/**
 * The form of a counted string for `count`: `name_one`, `name_other` and so on, by the language's
 * own plural rules. `count` fills the first placeholder, `args` the ones after it.
 */
export function getPlural(name: string, count: number, ...args: unknown[]): string {
  const lookup = strings as Record<string, string>;
  const exact = `${name}_${pluralRules.select(count)}`;
  const key = (exact in lookup ? exact : `${name}_other`) as StringKey;
  return getString(key, count, ...args);
}
