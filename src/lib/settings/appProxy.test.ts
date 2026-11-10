import { describe, expect, it } from "vitest";

import { appProxyUrl, configuredProxyUrl } from "./appProxy";

const values = { proxy_enabled: "true", proxy_type: "http", proxy_host: " proxy.test ", proxy_port: "3128" };

describe("appProxyUrl", () => {
  it("builds a URL for each protocol", () => {
    expect(appProxyUrl(values)).toBe("http://proxy.test:3128");
    expect(appProxyUrl({ ...values, proxy_type: "socks5" })).toBe("socks5h://proxy.test:3128");
    expect(appProxyUrl({ ...values, proxy_type: "socks4" })).toBe("socks4a://proxy.test:3128");
    expect(appProxyUrl({ ...values, proxy_host: "2001:db8::1" })).toBe("http://[2001:db8::1]:3128");
  });

  it("escapes credentials", () => {
    expect(appProxyUrl({ ...values, proxy_username: "a user", proxy_password: "p@ss:word" })).toBe(
      "http://a%20user:p%40ss%3Aword@proxy.test:3128",
    );
  });

  it("is null when off or incomplete", () => {
    expect(appProxyUrl({ ...values, proxy_enabled: "false" })).toBeNull();
    expect(appProxyUrl({ ...values, proxy_host: "" })).toBeNull();
    expect(appProxyUrl({ ...values, proxy_port: "70000" })).toBeNull();
  });

  it("uses the port Settings shows when none is saved", () => {
    expect(appProxyUrl({ ...values, proxy_port: "" })).toBe("http://proxy.test:8080");
    expect(appProxyUrl({ ...values, proxy_port: undefined })).toBe("http://proxy.test:8080");
  });

  it("tells a configured proxy that is off from one that isn't set up", () => {
    expect(configuredProxyUrl({ ...values, proxy_enabled: "false" })).toBe("http://proxy.test:3128");
    expect(configuredProxyUrl({ proxy_port: "8080" })).toBeNull();
  });
});
