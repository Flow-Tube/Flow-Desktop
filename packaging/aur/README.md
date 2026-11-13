# AUR packages

Two Arch User Repository packages:

- `flow-desktop-bin` repackages the release `.deb` (x86_64 and aarch64).
- `flow-desktop` builds the tagged source with `pnpm tauri build --bundles deb`
  and installs that `.deb` the same way.

They follow every tagged release, betas included, and conflict with each other.
Both install the binary as `/usr/bin/flow-desktop`, point the desktop file at
it, and add an empty `/usr/lib/<product>/distro-managed` marker. `<product>` is `Flow Beta` for
prerelease tags and `Flow` otherwise. The `.deb` names the binary
`flow-desktop` (`flow-desktop-beta` for prereleases); releases up to
0.1.0-beta3 named it `flow`, which the AUR's `flow` packages own, so the
install step renames whichever one it finds.

The block between the `Shared flow-desktop install steps` markers must stay
identical in both PKGBUILDs, since AUR packages can't share files. The AUR
workflow checks this.
