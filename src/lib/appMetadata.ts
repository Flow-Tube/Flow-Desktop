import { isTauriEnv } from "./api/env";

export interface AppMetadata {
  name: string;
  version: string;
  identifier: string;
  tauriVersion: string;
  bundleType: string;
  source: "tauri" | "fallback";
}

const FALLBACK_METADATA: AppMetadata = {
  name: "Flow",
  version: "0.1.0",
  identifier: "io.github.aedev.flow.desktop",
  tauriVersion: "unknown",
  bundleType: "browser",
  source: "fallback",
};

let cachedMetadata: AppMetadata | null = null;

const settleString = async (loader: () => Promise<string>, fallback: string) => {
  try {
    return await loader();
  } catch {
    return fallback;
  }
};

export async function getAppMetadata(): Promise<AppMetadata> {
  if (cachedMetadata) return cachedMetadata;

  if (!(await isTauriEnv())) {
    cachedMetadata = FALLBACK_METADATA;
    return cachedMetadata;
  }

  try {
    const appApi = await import("@tauri-apps/api/app");
    const [name, version, identifier, tauriVersion, bundleType] = await Promise.all([
      settleString(appApi.getName, FALLBACK_METADATA.name),
      settleString(appApi.getVersion, FALLBACK_METADATA.version),
      settleString(appApi.getIdentifier, FALLBACK_METADATA.identifier),
      settleString(appApi.getTauriVersion, FALLBACK_METADATA.tauriVersion),
      settleString(async () => String((await appApi.getBundleType()) ?? "unbundled"), "dev"),
    ]);

    cachedMetadata = {
      name,
      version,
      identifier,
      tauriVersion,
      bundleType,
      source: "tauri",
    };
    return cachedMetadata;
  } catch {
    cachedMetadata = FALLBACK_METADATA;
    return cachedMetadata;
  }
}
