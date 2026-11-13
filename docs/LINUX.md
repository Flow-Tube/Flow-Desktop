# Flow on Linux

Help for installing and running Flow Desktop on Linux. For the list of
supported systems, see the [README](../README.md#downloads-and-supported-systems).

## Which package to pick

| Your system | Package | Install with |
| --- | --- | --- |
| Debian, Ubuntu, Linux Mint, Pop!_OS | `.deb` | `sudo apt install ./Flow_*.deb` |
| Fedora, RHEL and its rebuilds | `.rpm` | `sudo dnf install ./Flow_*.rpm` |
| openSUSE | `.rpm` | `sudo zypper install ./Flow_*.rpm` |
| Arch, Manjaro, EndeavourOS | AUR | `flow-desktop-bin` (prebuilt) or `flow-desktop` (built from source) |
| Anything else, or an immutable system (Fedora Silverblue, SteamOS) | AppImage | Make it executable and run it |

Install a `.deb` or `.rpm` with the commands above rather than `dpkg -i` or
`rpm -i`, so the codec packages Flow needs come with it.

The AppImage brings its own WebKitGTK and codecs, so it plays everything
without system packages. The `.deb`, `.rpm` and AUR packages use your
system's WebKitGTK and GStreamer, which get your distribution's security
updates. A Flatpak is in testing in the nightly builds.

### Stable, Beta and Nightly

Each channel installs as its own app with its own data:

| Channel | Menu name | Command |
| --- | --- | --- |
| Stable | Flow | `flow-desktop` |
| Beta | Flow Beta | `flow-desktop-beta` |
| Nightly | Flow Nightly | `flow-desktop-nightly` |

The `.deb` and `.rpm` packages of different channels can be installed side
by side. The AUR packages install every channel as `flow-desktop`.

Releases up to 0.1.0-beta3 installed the command as `flow`. If you pinned
Flow to a dock or taskbar, pin it again after updating.

## Graphics problems

If Flow opens to a blank, black, white or flickering window, it is usually
WebKitGTK's GPU rendering failing on your driver (often NVIDIA, or some
Wayland sessions). Flow notices a launch that never showed a picture and
uses safer settings on the next launch by itself. You can also choose:

- **Settings > Appearance > Graphics compatibility**: Automatic (the
  default), Compatible (turns off the GPU buffer sharing that fails on some
  drivers) or Safe (also draws in software and uses X11). It applies the
  next time Flow starts.
- **Start with safe graphics**: right-click Flow in your app menu or dock and
  pick this action to start once in Safe mode, for example when the window
  is too broken to reach Settings. From a terminal, run
  `flow-desktop --safe-graphics`, or set `FLOW_SAFE_GRAPHICS=1`.

Advanced users can set the WebKitGTK variables themselves before starting
Flow. Your own values always win:

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` turns off GPU buffer sharing, and `=0`
  turns it back on when Flow turned it off.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` draws the page in software.
- `GDK_BACKEND=x11` runs the window through X11 or XWayland.

## Video codecs

Video plays through WebKitGTK and your system's GStreamer plugins. If sound
plays but the picture stays frozen, a video decoder is missing. Flow names
the missing codec on the player and falls back to VP9 where it can.

- **Debian and Ubuntu:** `sudo apt install gstreamer1.0-libav`. The `.deb`
  already pulls it in.
- **Fedora:** Fedora's own packages can't decode most YouTube H.264 video.
  Enable [RPM Fusion](https://rpmfusion.org/Configuration), then run
  `sudo dnf swap ffmpeg-free ffmpeg --allowerasing` and
  `sudo dnf install gstreamer1-plugin-libav`. `gstreamer1-plugin-openh264`
  and `gstreamer1-plugin-dav1d` (AV1) help too, and the `.rpm` recommends
  them.
- **Arch:** `sudo pacman -S gst-libav`. The AUR packages already depend on it.
- **openSUSE:** add the [Packman](https://en.opensuse.org/Additional_package_repositories#Packman)
  repository, then install `gstreamer-plugins-libav` and
  `gstreamer-plugins-bad-codecs` from it.

The AppImage needs none of these.

### Node.js

Flow can use Node.js 18 or newer, when it is installed, as a fallback for
YouTube's bot check. The packages recommend `nodejs`. Ubuntu 22.04's own
`nodejs` is too old for this; playback still works without it.

## Sync with Flow for Android

Sync talks to your phone over your local network. If your firewall blocks
incoming connections, allow these:

- TCP port 47900 for Linked devices and 47901 for a one-time transfer. Flow
  uses another port only when one of these is taken; the pairing screen shows
  the port in use as the last part of **This PC: address:port**;
- UDP port 5353, which devices use to find each other (mDNS).

The stable `.deb` and `.rpm` include a `flow-desktop` profile for both
firewalls, which opens nothing until you enable it. With `ufw` (Ubuntu, CachyOS
and others):

```sh
sudo ufw allow flow-desktop
```

With `firewalld` (Fedora, openSUSE and others):

```sh
sudo firewall-cmd --add-service=flow-desktop --permanent
sudo firewall-cmd --reload
```

Without the profile (AppImage, Beta, Nightly), open the ports by number:

```sh
sudo ufw allow 47900:47901/tcp
sudo ufw allow 5353/udp
```

```sh
sudo firewall-cmd --add-port=47900-47901/tcp --add-service=mdns --permanent
sudo firewall-cmd --reload
```

If the phone still can't connect after 45 seconds, the pairing screen shows the
command for your firewall with the port Flow is using, ready to copy.

Both devices must be on the same network, and a VPN can block the
connection.

## Media keys

**Settings > Keyboard Shortcuts > Global media keys** makes your keyboard's
play, next and previous keys work while Flow is in the background. This
needs an X11 session today: Wayland doesn't let apps listen for keys outside
their own window.

## Moving from Beta to Stable

Beta and Stable keep separate libraries, so moving over takes a backup:

1. In Flow Beta, open **Settings > Data & Backup** and set **Backup Scope**
   to **All Data**.
2. Under **Export Data**, click **Export** and save the file.
3. In Flow (Stable), open **Settings > Data & Backup > Import / Restore
   Database**, click **Import** and pick the file. On first start you can
   also pick **Restore a backup** during setup.

You can then uninstall Flow Beta, or keep both.
