import { describe, expect, it } from "vitest";

import { InFlightRuns } from "./inFlight";

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("in-flight runs", () => {
  it("makes a second caller wait for the running fetch instead of starting another", async () => {
    const runs = new InFlightRuns<string, string>();
    const gate = deferred<string>();
    let started = 0;
    const first = runs.join("v", () => {
      started++;
      return gate.promise;
    });
    const second = runs.join("v", async () => {
      started++;
      return "second";
    });
    gate.resolve("first");
    expect(await first).toBe("first");
    expect(await second).toBe("first");
    expect(started).toBe(1);
  });

  it("runs a finished key again on the next call", async () => {
    const runs = new InFlightRuns<string, number>();
    let started = 0;
    await runs.join("v", async () => ++started);
    await Promise.resolve();
    expect(await runs.join("v", async () => ++started)).toBe(2);
  });

  it("keeps the run going for the other caller when one leaves", async () => {
    const runs = new InFlightRuns<string, string>();
    const gate = deferred<string>();
    const leaving = new AbortController();
    let aborted = false;
    const left = runs.join(
      "v",
      (signal) => {
        signal.addEventListener("abort", () => (aborted = true));
        return gate.promise;
      },
      leaving.signal,
    );
    const staying = runs.join("v", async () => "unused");
    leaving.abort();
    await expect(left).rejects.toThrow();
    gate.resolve("lyrics");
    expect(await staying).toBe("lyrics");
    expect(aborted).toBe(false);
  });

  it("stops the run once every caller has left", async () => {
    const runs = new InFlightRuns<string, string>();
    const only = new AbortController();
    let aborted = false;
    const pending = runs.join(
      "v",
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
      only.signal,
    );
    only.abort();
    await expect(pending).rejects.toThrow();
    expect(aborted).toBe(true);
  });

  it("runs different keys separately", async () => {
    const runs = new InFlightRuns<string, string>();
    const [a, b] = await Promise.all([runs.join("a", async () => "A"), runs.join("b", async () => "B")]);
    expect([a, b]).toEqual(["A", "B"]);
  });
});
