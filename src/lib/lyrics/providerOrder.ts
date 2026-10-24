// Word/character-sync providers first, plain text last (Android's default order).
export const DEFAULT_PROVIDER_ORDER: readonly string[] = [
  "BetterLyrics",
  "LyricsPlus",
  "SimpMusic",
  "KuGou",
  "Paxsenix",
  "LrcLib",
  "YouTube",
];

/**
 * The order lyrics providers are tried in, as saved in settings. A provider the saved order has
 * never seen joins next to the provider it follows by default, not at the end, so an update that
 * adds one reaches people who reordered the list once. Port of Android's LyricsProviderOrder.
 */
export function resolveProviderOrder(saved: string | null | undefined): string[] {
  if (!saved?.trim()) return [...DEFAULT_PROVIDER_ORDER];
  const order = [
    ...new Set(
      saved
        .split(",")
        .map((name) => name.trim())
        .filter((name) => DEFAULT_PROVIDER_ORDER.includes(name)),
    ),
  ];
  DEFAULT_PROVIDER_ORDER.forEach((name, index) => {
    if (order.includes(name)) return;
    const predecessors = DEFAULT_PROVIDER_ORDER.slice(0, index).filter((p) => order.includes(p));
    const predecessor = predecessors[predecessors.length - 1];
    order.splice(predecessor ? order.indexOf(predecessor) + 1 : 0, 0, name);
  });
  return order;
}

export function serializeProviderOrder(names: string[]): string {
  return [...new Set(names.filter((name) => DEFAULT_PROVIDER_ORDER.includes(name)))].join(",");
}
