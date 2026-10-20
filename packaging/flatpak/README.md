# Flatpak

`io.github.flow_tube.Flow-Desktop.yml` builds Flow from source on the GNOME 51
runtime. The same manifest is used for the nightly CI bundle and, later, for
Flathub. Everything is built offline from pre-generated sources, as Flathub
requires.

## What is different in the Flatpak

- **App ID.** The Flatpak uses `io.github.flow_tube.Flow-Desktop` instead of
  `io.github.aedev.flow.desktop`. Only the Flatpak build changes it, through
  `src-tauri/tauri.flatpak.conf.json`, because Flatpak only lets an app own
  D-Bus names under its own ID and the single-instance name is
  `<identifier>.SingleInstance`.
- **Own data folder.** The library, settings, logs and startup state live in
  `~/.var/app/io.github.flow_tube.Flow-Desktop/data/io.github.flow_tube.Flow-Desktop/`.
  A Flatpak install does not see the data of a `.deb`, `.rpm` or AppImage
  install, and the other way around.
- **Bundled Node.** The poToken and n-signature helpers need Node, which the
  sandbox does not have. The `node` module copies Node 24 from the SDK
  extension into `/app/node`, and `FLOW_NODE`, `FLOW_INTEGRITY_SCRIPT` and
  `FLOW_NSIG_SCRIPT` point the app at it and at the helper scripts in
  `/app/lib/Flow/sidecar/`.
- **No Tauri CLI.** `tauri build` rejects underscores in identifiers, so the
  manifest runs `cargo build` with the `tauri/custom-protocol` feature and the
  Flatpak config passed through `TAURI_CONFIG`, which is what the CLI does.
- **No updater artifacts.** Flathub ships the updates.
- **Runtime libraries.** WebKitGTK and GStreamer come from the GNOME runtime,
  so none of the AppImage library workarounds apply.

## Regenerate the offline sources

```sh
scripts/flatpak-sources.sh
```

It writes `packaging/flatpak/generated-sources/` (ignored by git):

- `cargo-sources.json` from `src-tauri/Cargo.lock` (flatpak-cargo-generator)
- `node-sources.json` from `pnpm-lock.yaml` (flatpak-node-generator, pnpm
  store v11 for pnpm 11)
- `pnpm-release.json`, the pnpm release named in `package.json`'s
  `packageManager`, which is not part of its own lockfile

Run it again after any change to `Cargo.lock`, `pnpm-lock.yaml` or
`packageManager`. It needs `python3` (3.10 or newer, with `venv`), `git` and
`curl`. CI runs it before every Flatpak build.

## Build and install locally

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
scripts/flatpak-sources.sh
flatpak-builder --user --install --install-deps-from=flathub --force-clean \
  flatpak_app packaging/flatpak/io.github.flow_tube.Flow-Desktop.yml
flatpak run io.github.flow_tube.Flow-Desktop
```

Run these from the repository root. To make a single-file bundle instead:

```sh
flatpak-builder --user --repo=repo --install-deps-from=flathub --force-clean \
  flatpak_app packaging/flatpak/io.github.flow_tube.Flow-Desktop.yml
flatpak build-bundle repo Flow-Desktop.flatpak io.github.flow_tube.Flow-Desktop
```

Startup logging can be raised with
`flatpak run --env=RUST_LOG=debug io.github.flow_tube.Flow-Desktop`.

## Permissions

| Permission | Why |
| --- | --- |
| `--share=network`, `--share=ipc` | YouTube, the local streaming proxy, the browser extension bridge and LAN sync (plain TCP, paired by QR code) |
| `--socket=wayland`, `--socket=fallback-x11` | The window. X11 is only exposed when there is no Wayland |
| `--socket=pulseaudio` | Audio |
| `--device=dri` | GPU rendering and video decoding |
| `--talk-name=org.freedesktop.Notifications` | New-upload notifications |
| `--filesystem=xdg-videos/Flow:create`, `--filesystem=xdg-music/Flow:create` | Default download folders |
| `--filesystem=xdg-download` | Fallback download folder when Videos or Music is not set |

There is no tray permission, because Flow does not use a tray icon.

## Check in the bundle

These only show up in a real install:

- Picking a custom download folder (the dialog goes through the file chooser
  portal) and downloading into it.
- Playback, including H.264, and the poToken and n-signature log lines.
- `flow://` links from the browser extension opening the app.
- Sync pairing with Flow for Android, and notifications.

## Runtime support

GNOME 51 is supported until about September 2027. GNOME 52 drops
`webkit2gtk-4.1`, which Tauri 2 uses. If Tauri has not moved to WebKitGTK 6.0
by then, the fallback is building WebKitGTK as a module in this manifest, the
way `com.pot_app.pot` does on Flathub.
