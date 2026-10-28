import { describe, expect, it } from "vitest";

// Web storage is shared by every profile, so personal keys must go through the profile-scoped
// helper in src/lib/storage/. Files listed here still use it directly and are being moved.
const NOT_YET_SCOPED = new Set([
  "src/lib/api/db.ts",
  "src/lib/api/recommendation.ts",
  "src/lib/audio/eq/legacyMigration.ts",
  "src/lib/audio/volumeCurve.ts",
  "src/lib/continueWatching.ts",
  "src/lib/lyrics/cache.ts",
  "src/lib/lyrics/sourceChoice.ts",
  "src/lib/playlistSort.ts",
  "src/lib/useDeepLinkHandoff.ts",
  "src/lib/useVideoStream.ts",
  "src/store/useMusicPlayerStore.ts",
  "src/store/usePlayerStore.ts",
  "src/store/useSearchHistoryStore.ts",
  "src/store/useUiStore.ts",
]);

const sources = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.ts", "!/src/lib/storage/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function usesWebStorage(source: string): boolean {
  return /\b(localStorage|sessionStorage)\b/.test(withoutComments(source));
}

describe("web storage guard", () => {
  const offenders = Object.entries(sources)
    .filter(([, source]) => usesWebStorage(source))
    .map(([path]) => path.replace(/^\//, ""))
    .sort();

  it("finds the source files", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it("keeps web storage behind the profile-scoped helper", () => {
    expect(offenders.filter((path) => !NOT_YET_SCOPED.has(path))).toEqual([]);
  });

  it("has no stale entries in the list of files still to move", () => {
    expect([...NOT_YET_SCOPED].filter((path) => !offenders.includes(path))).toEqual([]);
  });
});
