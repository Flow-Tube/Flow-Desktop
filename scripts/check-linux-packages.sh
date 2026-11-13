#!/usr/bin/env bash
# Print what the built .deb and .rpm declare, and fail when a package would
# break link handling or clash with another channel.
#
# Checks:
# - the binary is /usr/bin/<expected-binary>, so Stable, Beta and Nightly
#   packages can be installed side by side;
# - the desktop entry's main Exec passes the URL (%u), or GIO launchers drop
#   flow:// links from the browser extension;
# - StartupWMClass names the same binary, so docks match the window.
# Usage: check-linux-packages.sh <bundle-dir> <expected-binary>
set -euo pipefail

bundle="$1"
binary="$2"
shopt -s nullglob
debs=("$bundle"/deb/*.deb)
rpms=("$bundle"/rpm/*.rpm)
[ "${#debs[@]}" -gt 0 ] || { echo "no .deb under $bundle/deb" >&2; exit 1; }

# The first Exec and StartupWMClass of the [Desktop Entry] group; the actions
# below it have their own Exec lines without %u.
main_entry() {
  awk '/^\[/ { main = ($0 == "[Desktop Entry]") } main && /^(Exec|StartupWMClass)=/' "$1"
}

check_entry() {
  local desktop=$1 entry
  entry="$(main_entry "$desktop")"
  grep -qx "Exec=$binary %u" <<<"$entry" \
    || { echo "the desktop entry's Exec must be '$binary %u'" >&2; exit 1; }
  grep -qx "StartupWMClass=$binary" <<<"$entry" \
    || { echo "the desktop entry's StartupWMClass must be '$binary'" >&2; exit 1; }
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for deb in "${debs[@]}"; do
  echo "::group::$(basename "$deb")"
  dpkg-deb -I "$deb"
  dpkg-deb --fsys-tarfile "$deb" | tar -xO --wildcards './usr/share/applications/*.desktop' >"$work/entry.desktop"
  cat "$work/entry.desktop"
  echo "::endgroup::"
  dpkg-deb -c "$deb" | grep -q " \./usr/bin/$binary\$" \
    || { echo "$(basename "$deb") does not install /usr/bin/$binary" >&2; exit 1; }
  check_entry "$work/entry.desktop"
done

for rpm in "${rpms[@]}"; do
  echo "::group::$(basename "$rpm")"
  echo "Requires:"
  rpm -qpR "$rpm"
  echo "Recommends:"
  rpm -qp --recommends "$rpm"
  echo "::endgroup::"
  rpm -qpl "$rpm" | grep -qx "/usr/bin/$binary" \
    || { echo "$(basename "$rpm") does not install /usr/bin/$binary" >&2; exit 1; }
done

echo "Linux packages install /usr/bin/$binary and pass links to it."
