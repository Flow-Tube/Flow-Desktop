import { SETTINGS } from "./schema";

type SettingValues = Partial<Record<string, string>>;

/** The port Settings shows before one is typed. The screen doesn't save it until the field is edited. */
const DEFAULT_PORT = "8080";

/** The proxy the user set up, as a URL, or null when it is off or incomplete. Mirrors `api/app_proxy.rs`. */
export function appProxyUrl(values: SettingValues): string | null {
  if (values[SETTINGS.PROXY_ENABLED] !== "true") return null;
  return configuredProxyUrl(values);
}

/** Whether a host and port are filled in, whether or not the proxy is on. */
export function configuredProxyUrl(values: SettingValues): string | null {
  const host = values[SETTINGS.PROXY_HOST]?.trim();
  const port = Number(values[SETTINGS.PROXY_PORT]?.trim() || DEFAULT_PORT);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const scheme = { socks5: "socks5h", socks4: "socks4a" }[values[SETTINGS.PROXY_TYPE] ?? ""] ?? "http";
  const user = values[SETTINGS.PROXY_USERNAME]?.trim();
  const password = values[SETTINGS.PROXY_PASSWORD];
  const auth = user
    ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ""}@`
    : "";
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${auth}${address}:${port}`;
}
