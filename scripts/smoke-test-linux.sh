#!/usr/bin/env bash
# Starts a built .deb or AppImage in a clean Ubuntu container under a virtual X
# server, and fails unless the app is still running after SMOKE_SECONDS, logged
# its Linux startup line and its webview confirmed a render (the
# startup_render_ok command, which records good_tier in startup_state.json).
#
# The .deb installs on 22.04, the oldest base it supports, without Recommends,
# so a missing Depends shows up. The AppImage, built on 24.04, runs on 24.04
# with a desktop's GTK and Mesa stack, since it leaves those to the host.
# Rendering is Mesa's software rasterizer: no GPU is needed.
#
# Usage: smoke-test-linux.sh <package.deb|package.AppImage>
set -euo pipefail

if [[ "${1:-}" == --inside ]]; then
  pkg="$2"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  desktop=(ca-certificates dbus xauth xvfb libegl1 libegl-mesa0 libgl1 libgl1-mesa-dri libgles2 libglx-mesa0)
  case "$pkg" in
    *.deb)
      apt-get install -y -qq --no-install-recommends "${desktop[@]}" "$pkg" >/dev/null
      name="$(dpkg-deb -f "$pkg" Package)"
      app="$(dpkg -L "$name" | grep -E '^/usr/bin/[^/]+$' | head -n1)"
      ;;
    *.AppImage)
      # postprocess-appimage.sh strips the bundled libwayland, so it comes
      # from the host, as on any Wayland desktop.
      apt-get install -y -qq --no-install-recommends "${desktop[@]}" \
        fonts-dejavu-core libasound2t64 libgtk-3-0t64 libwayland-server0 >/dev/null
      app=/tmp/app.AppImage
      cp "$pkg" "$app"
      chmod +x "$app"
      export APPIMAGE_EXTRACT_AND_RUN=1
      ;;
  esac
  [[ -n "$app" ]] || { echo "no binary under /usr/bin in $pkg" >&2; exit 1; }
  echo "Starting $app"

  log=/tmp/app.log
  export RUST_LOG=info NO_COLOR=1 LIBGL_ALWAYS_SOFTWARE=1
  dbus-run-session -- xvfb-run -a -s "-screen 0 1280x800x24" "$app" >"$log" 2>&1 &
  runner=$!

  rendered=""
  for ((second = 1; second <= SMOKE_SECONDS; second++)); do
    sleep 1
    if ! kill -0 "$runner" 2>/dev/null; then
      echo "the app exited after ${second}s" >&2
      cat "$log" >&2
      exit 1
    fi
    if [[ -z "$rendered" ]] && grep -qsE '"good_tier": ?[0-9]' "$HOME"/.local/share/*/startup_state.json; then
      rendered="${second}s"
    fi
  done

  echo "::group::App log"
  cat "$log"
  echo "::endgroup::"
  grep -q linux_startup_workarounds_applied "$log" \
    || { echo "the startup line linux_startup_workarounds_applied is missing" >&2; exit 1; }
  [[ -n "$rendered" ]] \
    || { echo "the webview never confirmed a render in ${SMOKE_SECONDS}s" >&2; exit 1; }
  echo "Still running after ${SMOKE_SECONDS}s, render confirmed after ${rendered}"
  exit 0
fi

pkg="$(realpath "$1")"
case "$pkg" in
  *.deb) image=ubuntu:22.04 ;;
  *.AppImage) image=ubuntu:24.04 ;;
  *) echo "expected a .deb or .AppImage: $pkg" >&2; exit 1 ;;
esac
script="$(realpath "${BASH_SOURCE[0]}")"
inside="/pkg/$(basename "$pkg")"

# WebKit wants more shared memory than Docker's 64 MB default.
docker run --rm --shm-size=1g \
  -e SMOKE_SECONDS="${SMOKE_SECONDS:-30}" \
  -v "$pkg:$inside:ro" \
  -v "$script:/smoke-test-linux.sh:ro" \
  "$image" bash /smoke-test-linux.sh --inside "$inside"
