// Builds Tauri updater manifests from signed packages. The nightly and release
// manifests share this; they differ only in file names, versions and URLs.

export const ARCH = { x64: "x86_64", amd64: "x86_64", x86_64: "x86_64", arm64: "aarch64", aarch64: "aarch64" };
export const BUNDLE = {
  "-setup.exe": "nsis",
  ".app.tar.gz": "app",
  ".deb": "deb",
  ".rpm": "rpm",
  ".AppImage": "appimage",
};
// The bundle a plain <os>-<arch> key points at, for installs whose bundle type
// the updater can't tell.
const DEFAULT_BUNDLE = { windows: "nsis", darwin: "app", linux: "appimage" };

/** Every key a manifest must fill for the given platforms. */
export function expectedKeys(platforms) {
  return platforms.flatMap((platform) =>
    ["x86_64", "aarch64"].flatMap((arch) => {
      const key = `${platform}-${arch}`;
      const bundles = platform === "linux" ? ["deb", "rpm", "appimage"] : [DEFAULT_BUNDLE[platform]];
      return [key, ...bundles.map((bundle) => `${key}-${bundle}`)];
    }),
  );
}

/**
 * `packages`: `[{ file, manifest, version, platform, arch, bundle, url }]`.
 * `expected`: `{ [manifest]: [platform key, …] }`.
 * Returns `{ [manifest]: manifest }`. Every package must be signed.
 */
export function buildManifests({ packages, signatures, notes, pubDate, expected }) {
  const unsigned = packages.filter(({ file }) => !signatures[file]).map(({ file }) => file);
  if (unsigned.length > 0) {
    throw new Error(`unsigned updater packages: ${unsigned.join(", ")}`);
  }

  const manifests = {};
  for (const { file, manifest, version, platform, arch, bundle, url } of packages) {
    manifests[manifest] ??= { version, notes, pub_date: pubDate, platforms: {} };
    if (manifests[manifest].version !== version) {
      throw new Error(`${file} is ${version}, ${manifest} is ${manifests[manifest].version}`);
    }
    const key = `${platform}-${arch}`;
    if (manifests[manifest].platforms[`${key}-${bundle}`]) {
      throw new Error(`two packages for ${key}-${bundle}`);
    }
    const entry = { signature: signatures[file].trim(), url };
    manifests[manifest].platforms[`${key}-${bundle}`] = entry;
    if (bundle === DEFAULT_BUNDLE[platform]) manifests[manifest].platforms[key] = entry;
  }

  for (const [file, keys] of Object.entries(expected)) {
    const missing = keys.filter((key) => !manifests[file]?.platforms[key]);
    if (missing.length > 0) throw new Error(`${file} is missing ${missing.join(", ")}`);
  }
  return manifests;
}

/** Reads `<file>.sig` beside each file that has one. */
export function readSignatures(files, read) {
  return Object.fromEntries(
    files.filter((name) => files.includes(`${name}.sig`)).map((name) => [name, read(`${name}.sig`)]),
  );
}
