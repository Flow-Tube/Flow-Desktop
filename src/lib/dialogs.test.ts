import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("confirmAction", () => {
  // Tauri makes window.confirm async, so `if (!confirm(...))` reads a Promise and always goes ahead.
  it("is the only way the app asks a yes/no question", () => {
    const native = Object.entries(sources)
      .filter(([, source]) => /(?:^|[^\w$.])confirm\(|window\.confirm\(/m.test(source))
      .map(([path]) => path);
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    expect(native).toEqual([]);
  });
});
