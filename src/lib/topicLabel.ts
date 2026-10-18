import type { UserBrain } from "./api/recommendation";

/** A key without its ":domain" tag ("metal:music" reads "metal"). */
export function stripDomainTag(topic: string): string {
  const index = topic.indexOf(":");
  return index > 0 ? topic.slice(0, index) : topic;
}

/** Each word with a capital, unless the text already holds one ("iPhone" stays). */
export function capitalized(text: string): string {
  if (/\p{Lu}/u.test(text)) return text;
  return text
    .split(" ")
    .map((word) => {
      const [first, ...rest] = Array.from(word);
      return first ? first.toUpperCase() + rest.join("") : word;
    })
    .join(" ");
}

/**
 * A topic key as people read it: the spelling titles use for it, else each word with a capital.
 * Keys are stemmed for matching ("vintag guitar"), so a raw key is never shown.
 */
export function topicLabel(brain: Pick<UserBrain, "display_forms">, key: string): string {
  const base = stripDomainTag(key);
  return brain.display_forms?.[base]?.form ?? capitalized(base);
}
