import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (command !== "dev" && command !== "build") {
  console.error("Commande attendue : dev ou build.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localCargoHome = join(root, "node_modules", ".cache", "flow-cargo");
const localRustupHome = join(root, "node_modules", ".cache", "flow-rustup");
const localCargoBin = join(localCargoHome, "bin");
const environment = { ...process.env };

const packageManagerBin = join(root, "node_modules", ".cache", "flow-package-manager");
const posixShim = join(packageManagerBin, "pnpm");
const windowsShim = join(packageManagerBin, "pnpm.cmd");
mkdirSync(packageManagerBin, { recursive: true });
writeFileSync(
  posixShim,
  `#!/bin/sh
workspace_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
case "$1" in
  list) shift; exec npm ls "$@" ;;
  build) "$workspace_root/node_modules/.bin/tsc" && "$workspace_root/node_modules/.bin/vite" build ;;
  dev) exec "$workspace_root/node_modules/.bin/vite" ;;
  *) printf 'Unsupported local pnpm command: %s\\n' "$1" >&2; exit 1 ;;
esac
`,
);
chmodSync(posixShim, 0o755);
writeFileSync(
  windowsShim,
  `@echo off
if "%1"=="list" (
  shift
  call npm ls %*
  if errorlevel 1 exit /b 1
  exit /b 0
)
if "%1"=="build" (
  call "%~dp0\\..\\..\\..\\node_modules\\.bin\\tsc.cmd"
  if errorlevel 1 exit /b 1
  call "%~dp0\\..\\..\\..\\node_modules\\.bin\\vite.cmd" build
  if errorlevel 1 exit /b 1
  exit /b 0
)
if "%1"=="dev" (
  call "%~dp0\\..\\..\\..\\node_modules\\.bin\\vite.cmd"
  if errorlevel 1 exit /b 1
  exit /b 0
)
echo Unsupported local pnpm command: %1 1>&2
exit /b 1
`,
);
environment.PATH = `${packageManagerBin}${delimiter}${environment.PATH ?? ""}`;
environment.npm_execpath = process.platform === "win32" ? windowsShim : posixShim;

if (existsSync(join(localCargoBin, "cargo"))) {
  environment.CARGO_HOME = localCargoHome;
  environment.RUSTUP_HOME = localRustupHome;
  environment.PATH = `${localCargoBin}${delimiter}${environment.PATH ?? ""}`;
}

const tauri = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const argumentsList = command === "build"
  ? ["build", "--config", join(root, "src-tauri", "tauri.local.conf.json")]
  : ["dev"];
const result = spawnSync(tauri, argumentsList, {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
