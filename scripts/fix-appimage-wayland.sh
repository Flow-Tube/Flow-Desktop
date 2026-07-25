#!/usr/bin/env bash
# Strip the bundled libwayland-* client libraries from a Tauri AppImage so it
# loads the host copies at runtime.
#
# Why: the Ubuntu 22.04 build host ships an older libwayland than recent Mesa
# stacks (Fedora/Arch/CachyOS, per issue #40) expect. An AppImage puts its
# bundled libs first on the loader search path, so the stale copy wins and EGL
# creation aborts with `EGL_BAD_PARAMETER`. libgdk-3 hard-links these libs, so
# removing them only redirects resolution to the host copy — which every
# GTK-capable system has. They are on the AppImage excludelist for exactly this
# reason.
# Usage: fix-appimage-wayland.sh <path-to.AppImage>
# Rewrites the AppImage in place (x86_64). Any detached .sig must be regenerated
# by the caller, since the bytes change.
set -euo pipefail

appimage="$1"
name="$(basename "$appimage")"
echo "Stripping bundled Wayland libs from: $appimage"

work="$(mktemp -d)"
cp "$appimage" "$work/"
pushd "$work" >/dev/null
chmod +x "./$name"
"./$name" --appimage-extract >/dev/null

# Fail loud if Tauri/linuxdeploy stops bundling these, so a future layout change
# can't silently ship an unfixed AppImage.
for lib in libwayland-client.so.0 libwayland-egl.so.1 libwayland-cursor.so.0; do
  test -e "squashfs-root/usr/lib/$lib" \
    || { echo "expected bundled lib missing: $lib (AppImage layout changed?)"; exit 1; }
done

rm -f squashfs-root/usr/lib/libwayland-client.so.0 \
      squashfs-root/usr/lib/libwayland-egl.so.1 \
      squashfs-root/usr/lib/libwayland-cursor.so.0 \
      squashfs-root/usr/lib/libwayland-server.so.0

curl -fsSL -o appimagetool.AppImage \
  https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
chmod +x appimagetool.AppImage
ARCH=x86_64 ./appimagetool.AppImage --appimage-extract-and-run squashfs-root "$name"

# Verify the repack before it replaces the original: libs gone, app binary kept.
rm -rf squashfs-root
chmod +x "./$name"
"./$name" --appimage-extract >/dev/null
for lib in libwayland-client.so.0 libwayland-egl.so.1 libwayland-cursor.so.0; do
  test ! -e "squashfs-root/usr/lib/$lib" \
    || { echo "lib still present after repack: $lib"; exit 1; }
done
test -n "$(ls -A squashfs-root/usr/bin 2>/dev/null)" \
  || { echo "no binary in repacked AppImage (repack failed?)"; exit 1; }
popd >/dev/null

cp "$work/$name" "$appimage"
rm -rf "$work"
echo "Stripped and repacked: $appimage"
