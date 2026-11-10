// Writes src/lib/about/thirdPartyNotices.json, the list behind Settings > About > Open source
// notices, from the lockfiles. Run it after adding a dependency; notices.test.ts fails otherwise.
// Usage: node scripts/generate-notices.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUTPUT = "src/lib/about/thirdPartyNotices.json";
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const OWN_PACKAGES = new Set(["flow", "flow-desktop"]);

// Code carried in this repository rather than pulled in through a package manager.
const VENDORED = [["ChangeVolumeMixerForWebView (Drapondur)", "", "MIT"]];

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES });
}

function cargoEntries() {
  const metadata = JSON.parse(
    run("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]),
  );
  return metadata.packages
    .filter((pkg) => !OWN_PACKAGES.has(pkg.name))
    .map((pkg) => [pkg.name, pkg.version, pkg.license ?? "See the project"]);
}

function pnpmEntries() {
  const byLicense = JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"]));
  return Object.entries(byLicense).flatMap(([license, packages]) =>
    packages.flatMap((pkg) => (pkg.versions ?? [pkg.version]).map((version) => [pkg.name, version, license])),
  );
}

const entries = [...cargoEntries(), ...pnpmEntries(), ...VENDORED].sort((a, b) =>
  a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], undefined, { numeric: true }),
);
const lines = entries.map((entry) => `  ${JSON.stringify(entry)}`).join(",\n");
writeFileSync(OUTPUT, `[\n${lines}\n]\n`);
console.log(`${entries.length} entries written to ${OUTPUT}`);
