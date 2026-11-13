# AUR packages

Three Arch User Repository packages:

- `flow-desktop-bin` repackages the release `.deb` (x86_64 and aarch64).
- `flow-desktop` builds the tagged source with `pnpm tauri build --bundles deb`
  and installs that `.deb` the same way.
- `flow-desktop-git` builds the latest `main` the same way. Its `pkgver()`
  turns `git describe` into e.g. `0.1.0beta3.r42.gabc1234`, which sorts after
  the `0.1.0beta3` release and before `0.1.0`.

`flow-desktop` and `flow-desktop-bin` follow every tagged release, betas
included, and the three conflict with each other. A release tag maps to a
pkgver without the dash: `v0.1.0-beta3` is `0.1.0beta3`, `v0.1.0` is `0.1.0`.
The PKGBUILDs here stay pinned to the last release; the release workflow sets
the new pkgver and checksums when it publishes. `flow-desktop-git` is never
published from CI, and a change to its pkgver alone is not worth a commit.

All three install the binary as `/usr/bin/flow-desktop` and point the desktop
file's `Exec` and `StartupWMClass` at it. The `.deb` names the binary
`flow-desktop` (`flow-desktop-beta` for prereleases); releases up to
0.1.0-beta3 named it `flow`, which the AUR's `flow` packages own, so the
install step renames whichever one it finds. Each package adds an empty
`/usr/lib/<product>/distro-managed` marker so the in-app updater stays off.
`<product>` is `Flow Beta` for prerelease versions and `Flow` otherwise;
`flow-desktop-git` reads the version from `package.json`.

The block between the `Shared flow-desktop install steps` markers must stay
identical in every PKGBUILD, since AUR packages can't share files. The AUR
workflow checks this, and that each `.SRCINFO` matches its PKGBUILD.
