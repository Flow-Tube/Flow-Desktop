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
| Any distribution with Flatpak, including immutable ones (Fedora Silverblue, SteamOS) | Flatpak from [FlatPark](https://flatpark.org/apps/io.github.aedev.flow.desktop/) | `flatpak remote-add --if-not-exists flatpark https://dl.flatpark.org/flatpark.flatpakrepo`, then `flatpak install flatpark io.github.aedev.flow.desktop` |
| Anything else | AppImage | Make it executable and run it |

Install a `.deb` or `.rpm` with the commands above rather than `dpkg -i` or
`rpm -i`, so the codec packages Flow needs come with it.

The AppImage brings its own WebKitGTK and codecs, so it plays everything
without system packages. The `.deb`, `.rpm` and AUR packages use your
system's WebKitGTK and GStreamer, which get your distribution's security
updates. The FlatPark Flatpak installs the official `.deb` unmodified on the
GNOME runtime with its codecs, and updates through `flatpak update` (Flow's
own updater stays off there). It follows the latest release, betas included,
keeps its data inside its sandbox, and has no access to your files. Flow's own
Flatpak is still in testing in the nightly builds.

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

### When Flow feels slow

Every safer setting costs speed. Settings > About shows which one Flow is
on, in the Graphics row:

- **GPU**: the fast path. Nothing is turned off.
- **GPU through shared memory**: the page is still drawn by the GPU, but each
  finished frame is copied through memory. The cost grows with the size of
  the window, so a maximized window on a 4K screen is much slower than a
  small one.
- **No GPU**: the page and the video are drawn by the processor. This is the
  slowest setting.

If Flow is on a slower setting than it may need, it says so once and offers
**Try faster graphics**, which is also in Settings > Appearance. Flow
restarts on a faster setting and asks whether to keep it. If the window is
blank you cannot answer, so Flow goes back on its own after 15 seconds and
does not try that setting again until WebKitGTK is updated.

On Linux, Flow also holds a few things still that would otherwise ask for a
new frame all the time: the bars beside the playing song, the dot on live
videos, the fade between pages and the side menu's slide. The video has
square corners, and Ambient mode stays off on the two slower settings.

Auto quality stops at 1080p on Linux and stays on H.264, because video is
mostly decoded by the processor there. A quality you pick yourself is not
limited.

Flow 0.1.0-beta3 could move a working computer onto a slower setting and
keep it there. The first launch of a newer version tries the fast path once
for those installs, with the same question.

Two things Flow cannot change:

- **Display scaling such as 125% or 150%.** GTK 3, which WebKitGTK uses,
  draws at 200% and lets the desktop shrink the result. A maximized window
  on a 4K screen at 150% is drawn at 5120 by 2880. A whole-number scale
  (100% or 200%) or a smaller window is faster.
- **X11 sessions.** There WebKitGTK copies each frame on the processor even
  on the fast path.

On NVIDIA with Wayland, Flow starts on shared memory and Try faster graphics
is not offered. The direct GPU path fails on many driver and WebKitGTK
combinations (a green picture where the video should be, or a crash), and
Debian, Ubuntu and Gentoo make the same choice in their WebKitGTK.

On NVIDIA with WebKitGTK 2.52 or later, Flow does not move to Safe by
itself, because drawing without the GPU crashes or leaves the window blank on
some of these systems. You can still choose it. If the video is a green
picture, try Safe in Settings > Appearance > Graphics compatibility, or
"Start with safe graphics" for one launch. If Safe leaves the window blank,
quit Flow and delete `startup_state.json` to go back to Automatic. The deb,
rpm and AppImage builds keep it in
`~/.local/share/io.github.aedev.flow.desktop/` (Flow Beta adds `.beta` to
the folder name).

Advanced users can set the WebKitGTK variables themselves before starting
Flow. Your own values always win. When you set one of the three
`WEBKIT_*DMABUF*` variables below, Flow also sets none of the others, ignores
the graphics mode it chose or remembered by itself, and does not remember how
that start went, so a test that crashes changes nothing for later starts.
Your choice in Settings and "Start with safe graphics" still apply.
Settings > About then says "started with your own variables":

- `WEBKIT_DISABLE_DMABUF_RENDERER=1` turns off GPU buffer sharing, and `=0`
  turns it back on when Flow turned it off.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` draws the page in software.
- `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` copies frames through shared memory.
- `WEBKIT_FORCE_DMABUF_RENDERER=1` keeps the direct GPU path where your
  distribution's WebKitGTK turns it off.
- `GDK_BACKEND=x11` runs the window through X11 or XWayland.
- On NVIDIA, to try the direct GPU path yourself, start Flow with
  `WEBKIT_DMABUF_RENDERER_FORCE_SHM=0 __NV_DISABLE_EXPLICIT_SYNC=1`, and on
  Debian, Ubuntu and Gentoo also `WEBKIT_FORCE_DMABUF_RENDERER=1`. Play a
  video before you rely on it.

## Equalizer and Volume boost on videos

On Linux the equalizer and Volume boost do not apply to videos and Shorts,
and their settings show "Not available". WebKitGTK passes a video's sound to
them about a second early, which pushed the sound out of step with the
picture after a pause, and it never frees a video that used them, so Flow
ran out of open files and reloaded. The equalizer still works for music.

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
