/**
 * Detects whether a string represents view counts, stream counts, or live watching status
 * rather than a channel name.
 */
export function isStatsString(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (/^no\s+views?$/i.test(t)) return true;
  if (!/^\d/.test(t)) return false;

  const countRegex =
    /\b(views?|watching|waiting|aufruf\w*|vues?|просмотр\w*|visualizz\w*|visualizaç\w*|vistas?|reproducc\w*|weergav\w*|wyświetl\w*|visning\w*|näyttö\w*|katselukert\w*|lượt xem|조회수|回視聴|次观看|次觀看|тыс|млн|млрд)\b/i;
  const compactRegex =
    /^\d[\d,.\s]*([kKmMbB千万亿]|тыс|млн|млрд)?\s*(views?|watching)?$/i;
  const ageRegex =
    /\b(ago|hours?|days?|weeks?|months?|years?|mins?|minutes?|secs?|seconds?|hier|heute|today|yesterday|gestern|сегодня|вчера)\b/i;

  return countRegex.test(t) || compactRegex.test(t) || ageRegex.test(t);
}

/**
 * Strips view count / stats text if mistakenly supplied or stored as a channel name.
 */
export function cleanChannelName(channelName: string | null | undefined): string {
  if (!channelName) return "";
  const trimmed = channelName.trim();
  if (isStatsString(trimmed)) {
    return "";
  }
  return trimmed;
}
