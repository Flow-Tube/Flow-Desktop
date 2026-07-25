<div align="center">
  <img src="Assets/logo.png" alt="Flow logo" width="132">

  # Flow Desktop

  **A privacy-respecting YouTube and YouTube Music client with a native, fully local recommendation engine.**

  Flow Desktop is the desktop companion to [Flow for Android](https://github.com/A-EDev/Flow), built with Rust, Tauri, React, and TypeScript.

  [![Status](https://img.shields.io/badge/Status-Active_Development-success?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/FlowNeuro/Flow-Desktop/commits/main)

  [![Downloads](https://img.shields.io/github/downloads/FlowNeuro/Flow-Desktop/total?style=for-the-badge&color=orange&logo=github&label=Downloads)](https://github.com/FlowNeuro/Flow-Desktop/releases) [![Latest Version](https://img.shields.io/github/v/release/FlowNeuro/Flow-Desktop?style=for-the-badge&color=crimson&label=Latest%20Version&include_prereleases)](https://github.com/FlowNeuro/Flow-Desktop/releases)

  [![Platform](https://img.shields.io/badge/Windows_·_macOS_·_Linux-3DDC84?style=for-the-badge&logo=linux&logoColor=white)](#downloads-and-supported-systems) [![Rust](https://img.shields.io/badge/Rust-CE422B?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/) [![Tauri](https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)](https://v2.tauri.app/)

  [![Reddit](https://img.shields.io/badge/Reddit-r%2FFlow__Official-FF4500?style=for-the-badge&logo=reddit&logoColor=white)](https://www.reddit.com/r/Flow_Official/) [![Stars](https://img.shields.io/github/stars/FlowNeuro/Flow-Desktop?style=for-the-badge&logo=star&color=gold)](https://github.com/FlowNeuro/Flow-Desktop/stargazers) [![License](https://img.shields.io/badge/License-GPL_v3.0-blue?style=for-the-badge&logo=gnu-bash&logoColor=white)](LICENSE) [![Last Commit](https://img.shields.io/github/last-commit/FlowNeuro/Flow-Desktop?style=for-the-badge&color=red)](https://github.com/FlowNeuro/Flow-Desktop/commits/main)

  [**Downloads**](https://github.com/FlowNeuro/Flow-Desktop/releases) · [**Android app**](https://github.com/A-EDev/Flow) · [**Community**](https://www.reddit.com/r/Flow_Official/) · [**Support development**](#support--donations)
</div>

> Flow Desktop is under active development. Features and storage formats may change before the first stable release.

---

## Features

- Native video playback with quality and codec selection, SABR/DASH/HLS support, chapters, subtitles, playback speed, queues, mini-player, and Picture-in-Picture.
- YouTube Music home, search, artists, albums, playlists, queue management, synchronized lyrics, repeat, shuffle, and equalizer controls.
- A dedicated Shorts feed with comments, descriptions, saved Shorts, looping, auto-next, and timed scrolling modes.
- Local subscriptions, playlists, Watch Later, likes, albums, video and music history, Continue Watching, and regional Explore feeds.
- Channel pages with videos, Shorts, playlists, community posts, comments, and live chat support.
- SponsorBlock, DeArrow, and Return YouTube Dislike integrations.
- Imports from Flow backups, Google Takeout, NewPipe, LibreTube, FreeTube, and OPML.

### FlowNeuro

FlowNeuro is Flow's native local recommendation engine. It learns from watches, skips, likes, dislikes, searches, topic preferences, and creator affinity, and ranks content on your device without sending a recommendation profile to a Flow server.

The Control Center lets you inspect topic weights, time-based patterns, channel memory, learning activity, and blocked content. You can export, import, reset, or temporarily pause learning with Deep Flow mode.

---

## Privacy and security

- No Google account is required, and Flow contains no advertising or analytics SDK.
- History, settings, library data, and recommendation state are stored locally in SQLite.
- Tauri permissions are restricted to the main window and the OS, dialog, and external-link capabilities the app uses.
- A strict Content Security Policy blocks arbitrary scripts, frames, objects, and remote application code.
- Rust validates search terms, video IDs, channel IDs, browse IDs, and continuation tokens before network requests.
- Media is relayed through a tokenized loopback-only proxy instead of exposing a public local server.
- BotGuard and PO-token handling run through a native hidden WebView, with a packaged Node script retained only as a compatibility fallback.

Flow still contacts YouTube and optional services such as SponsorBlock, DeArrow, Return YouTube Dislike, and configured lyrics providers when their features are used.

---

## Downloads and supported systems

Release builds are published through [GitHub Releases](https://github.com/FlowNeuro/Flow-Desktop/releases).

- **Stable:** reviewed releases intended for normal use.
- **Beta / RC:** public GitHub prereleases for wider testing. These install as **Flow Beta** with isolated application data.
- **Nightly:** automatic snapshots from `main`. These install as **Flow Nightly**, use isolated data, and may be unstable. Download the latest packages from [GitHub Actions](https://github.com/FlowNeuro/Flow-Desktop/actions/workflows/build.yml) or [nightly.link](https://nightly.link/FlowNeuro/Flow-Desktop/workflows/build/main) without a GitHub account.

| Platform | Supported versions | Architectures | Packages |
| --- | --- | --- | --- |
| Windows | Windows 10 22H2, Windows 11 | x64, ARM64 | NSIS installer |
| macOS | macOS 13 Ventura or later | Intel x64, Apple Silicon | DMG |
| Linux | Ubuntu 22.04+, Debian 12+, and comparable modern distributions | x64, ARM64 | AppImage, `.deb`, `.rpm` |

Linux builds require a compatible glibc, GTK 3, and WebKitGTK 4.1 environment. Legacy 32-bit systems are not supported.

### Linux media codecs

On Linux, video decoding goes through WebKitGTK and the system GStreamer plugins (Windows and macOS ship their own decoders). If audio plays but video stays frozen on a spinner, a video decoder is missing.

- **AppImage** — bundles the required GStreamer codec plugins (including `gst-libav` for H.264); no system codec packages are needed.
- **`.deb`** — declares the codec plugins as dependencies. Install with `sudo apt install ./Flow_*.deb` so they are pulled in automatically.
- **`.rpm`** — the freely licensed plugins are hard dependencies. On Fedora, H.264 decoding (`gstreamer1-libav`, `gstreamer1-plugins-bad-freeworld`) is only available from [RPM Fusion](https://rpmfusion.org/Configuration) for patent reasons: enable RPM Fusion and run `sudo dnf install gstreamer1-libav gstreamer1-plugins-bad-freeworld`, or use the AppImage instead.

### Linux startup crashes and blank windows

If the app opens to a blank or white window, that is usually the WebKitGTK DMABUF renderer failing on your graphics stack (common with NVIDIA proprietary drivers and some Wayland sessions). Flow disables it automatically and, if a launch still fails to render, **escalates GPU workarounds on the next launch on its own**: first forcing software compositing (`WEBKIT_DISABLE_COMPOSITING_MODE=1`), then falling back to X11/XWayland (`GDK_BACKEND=x11`). A clean launch resets this. You can still override any of these yourself — for example `WEBKIT_DISABLE_DMABUF_RENDERER=0` to re-enable the DMABUF renderer.

If the app aborts on startup with `Could not create default EGL display: EGL_BAD_PARAMETER` (seen on some Arch-family / Mesa systems with the **AppImage**), that is a known Tauri AppImage packaging issue: a bundled `libwayland` client library conflicts with your system's newer Mesa/EGL stack. As an interim workaround, delete the bundled Wayland libraries and run the extracted app:

```sh
./Flow_*_linux_amd64.AppImage --appimage-extract
rm squashfs-root/usr/lib/*wayland*so*
./squashfs-root/AppRun
```

On Arch-family distributions the AUR package and the planned Flatpak build avoid this class of issue; prefer those when available.

---

## Development

Requirements: Node.js 22.12+, pnpm 11.9+, stable Rust, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

Build packages for the current operating system:

```sh
pnpm test
pnpm build
pnpm tauri build
```

Windows, Linux, and macOS packages are built natively by the GitHub Actions release workflow. Production macOS and Windows releases should be signed and, on macOS, notarized before publication.

---

<a id="support--donations"></a>
## Support & donations

Flow is free and open-source software maintained by an independent developer. Patreon supports card, PayPal, Apple Pay, recurring support, and one-time tips.

[![Support Flow on Patreon](https://img.shields.io/badge/Patreon-Support_Flow-FF424D?style=for-the-badge&logo=patreon&logoColor=white)](https://patreon.com/A_EDev)

You can also donate directly with crypto. Scan a QR code using a compatible wallet, or click it where custom wallet links are supported. The address and network are printed below every code — always verify both before sending.

<table>
  <tr>
    <td align="center">
      <strong>USDT · TRC20</strong><br><br>
      <a href="tron:TRz7VDrTWwCLCfQmYBEJakqcZgbFNWfUMP"><img src="Assets/donations/usdt-trc20.png" alt="USDT TRC20 donation QR code" width="170"></a><br><br>
      <code>TRz7VDrTWwCLCfQmYBEJakqcZgbFNWfUMP</code>
    </td>
    <td align="center">
      <strong>Bitcoin · BTC</strong><br><br>
      <a href="bitcoin:bc1qgmkkxxvzvsymtpfazqfl93jw6k4jgy0xmrtnv8?label=Flow%20Development"><img src="Assets/donations/bitcoin.png" alt="Bitcoin donation QR code" width="170"></a><br><br>
      <code>bc1qgmkkxxvzvsymtpfazqfl93jw6k4jgy0xmrtnv8</code>
    </td>
    <td align="center">
      <strong>Ethereum · ERC-20</strong><br><br>
      <a href="ethereum:0xfbac6f464fec7fe458e318971a42ba45b305b70e"><img src="Assets/donations/ethereum.png" alt="Ethereum donation QR code" width="170"></a><br><br>
      <code>0xfbac6f464fec7fe458e318971a42ba45b305b70e</code>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <strong>Solana · SOL</strong><br><br>
      <a href="solana:7b3SLgiVPb8qQUvERSPGRWoFoiGEDvkFuY98M1GEngug?label=Flow%20Development"><img src="Assets/donations/solana.png" alt="Solana donation QR code" width="170"></a><br><br>
      <code>7b3SLgiVPb8qQUvERSPGRWoFoiGEDvkFuY98M1GEngug</code>
    </td>
    <td align="center">
      <strong>Monero · XMR</strong><br><br>
      <a href="monero:8AgaxZnpEvT8VXJpczpL7BQejwSEw97saJmKYqq4zKErbe9bkYSwUhJ813msPPbdYhF11oz4N7tfEj4Zi6k27fKD83ca1if"><img src="Assets/donations/monero.png" alt="Monero donation QR code" width="170"></a><br><br>
      <code>8AgaxZnpEvT8VXJpczpL7BQejwSEw97saJmKYqq4zKErbe9bkYSwUhJ813msPPbdYhF11oz4N7tfEj4Zi6k27fKD83ca1if</code>
    </td>
  </tr>
</table>

Wallet URI support varies between wallet applications. Bitcoin, Ethereum, Solana, and Monero QR codes use their standard payment URI formats; the TRC20 code uses a Tron URI and may fall back to displaying the address in wallets that do not register the scheme.

---

## License

Flow Desktop is free software licensed under the [GNU General Public License v3.0](LICENSE).

This license requires that any project using Flow's source code, including the FlowNeuro engine, must also be released as open source under GPLv3. It may not be used in a proprietary or closed-source application.

Copyright © 2025–2026 A-EDev