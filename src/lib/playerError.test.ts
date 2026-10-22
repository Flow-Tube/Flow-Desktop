import { describe, expect, it } from "vitest";

import { classifyPlayerError } from "./playerError";
import { BackendApiError } from "./api/errors";

describe("classifyPlayerError", () => {
  it("classifies a terminal content restriction as non-retryable but openable", () => {
    const info = classifyPlayerError(
      new BackendApiError("This video is private", "privateContent", null),
    );
    expect(info.kind).toBe("privateContent");
    expect(info.retryable).toBe(false);
    expect(info.canOpenInBrowser).toBe(true);
    expect(info.title).toBe("Private video");
    expect(info.rawMessage).toBe("This video is private");
  });

  it("classifies extraction failures as retryable", () => {
    const info = classifyPlayerError(
      new BackendApiError("format changed", "extractor", null),
    );
    expect(info.kind).toBe("extractor");
    expect(info.retryable).toBe(true);
    expect(info.canOpenInBrowser).toBe(true);
  });

  it("gives backend network and rate-limit failures their own retryable states", () => {
    const network = classifyPlayerError(new BackendApiError("browse: the request timed out", "network", null));
    expect(network.kind).toBe("network");
    expect(network.retryable).toBe(true);
    expect(network.title).toBe("No connection");

    const limited = classifyPlayerError(new BackendApiError("browse: rate limited", "rateLimited", null));
    expect(limited.kind).toBe("rateLimited");
    expect(limited.retryable).toBe(true);
    expect(limited.title).toBe("YouTube asked Flow to slow down");
  });

  it("accepts a raw { message, kind } error-response object", () => {
    const info = classifyPlayerError({ message: "premium only", kind: "musicPremium" });
    expect(info.kind).toBe("musicPremium");
    expect(info.retryable).toBe(false);
    expect(info.title).toBe("YouTube Music Premium content");
  });

  it("refines an unknown client-side failure that looks network-related", () => {
    const info = classifyPlayerError("Failed to fetch");
    expect(info.kind).toBe("network");
    expect(info.retryable).toBe(true);
    expect(info.title).toBe("No connection");
  });

  it("keeps app-side kinds non-openable", () => {
    const info = classifyPlayerError(new BackendApiError("bad id", "validation", null));
    expect(info.kind).toBe("validation");
    expect(info.canOpenInBrowser).toBe(false);
  });

  it("falls back to a generic, retryable error for unrecognized kinds", () => {
    const info = classifyPlayerError(new BackendApiError("weird", "somethingNew", null));
    expect(info.kind).toBe("somethingNew");
    expect(info.retryable).toBe(true);
    expect(info.title).toBe("Playback unavailable");
  });
});
