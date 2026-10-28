import { describe, expect, it } from "vitest";

// Web storage is shared by every profile, so every key must go through the profile-scoped
// helper in src/lib/storage/.

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
    expect(offenders).toEqual([]);
  });
});
