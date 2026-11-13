// Nightly builds are versioned <base>-nightly.<run> on Windows and macOS and
// <base>+nightly.<run> on Linux. The RPM bundler rejects "-", and NSIS accepts
// only numeric build metadata. The updater compares its manifest's version with
// the running app's, and the semver crate ranks build metadata (numerically per
// part), so each form gets its own manifest and both rise with the run number.

export const NIGHTLY_TAG = "nightly";

export function nightlyVersion(baseVersion, runNumber, platform) {
  const core = String(baseVersion).split(/[+-]/, 1)[0];
  const separator = platform === "linux" ? "+" : "-";
  return `${core}${separator}nightly.${runNumber}`;
}

export function nightlyManifestName(platform) {
  return platform === "linux" ? "latest-linux.json" : "latest.json";
}

export function nightlyDownloadUrl(repository, asset) {
  return `https://github.com/${repository}/releases/download/${NIGHTLY_TAG}/${encodeURIComponent(asset)}`;
}
