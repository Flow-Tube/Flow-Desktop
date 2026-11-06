import strings from './strings.json';

export type StringKey = keyof typeof strings;

/** The language the interface is written in. */
export const APP_LOCALE = 'en';

/** A string with `%s`, `%d` or positional `%1$s` placeholders filled in. */
export function getString(key: StringKey, ...args: unknown[]): string {
  const template = (strings[key] as string) || String(key);
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?[sd]/g, (placeholder, position?: string) => {
    const index = position ? Number(position) - 1 : next++;
    return index < args.length ? String(args[index]) : placeholder;
  });
}

const pluralRules = new Intl.PluralRules(APP_LOCALE);

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
