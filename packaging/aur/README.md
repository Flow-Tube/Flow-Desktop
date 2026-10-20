# AUR packages

Two Arch User Repository packages, kept here and pushed to the AUR by hand:

- `flow-desktop-bin` repackages the release `.deb` (x86_64 and aarch64).
- `flow-desktop` builds the tagged source with `pnpm tauri build --bundles deb`
  and installs that `.deb` the same way.

They follow every tagged release, betas included, and conflict with each other.
Both install the binary as `/usr/bin/flow-desktop` (the AUR's `flow` packages
own `/usr/bin/flow`), point the desktop file at it, and add an empty
`/usr/lib/<product>/distro-managed` marker. `<product>` is `Flow Beta` for
prerelease tags and `Flow` otherwise.

Publish nothing older than `v0.1.0-beta3`. Earlier releases ignore the marker,
so they offer in-app updates, and they don't look for their Node sidecar
scripts in `/usr/lib/<product>`. The PKGBUILDs stay pinned to the latest
published release until then so the workflow has real assets to build.

The block between the `Shared flow-desktop install steps` markers must stay
identical in both PKGBUILDs, since AUR packages can't share files. The AUR
workflow checks this.

## Updating for a release

Do this after the GitHub release is published, so its assets exist:

1. In both PKGBUILDs set `pkgver` to the tag without `v` and without the dash
   (`v0.1.0-beta3` becomes `0.1.0beta3`, which sorts below `0.1.0`), and reset
   `pkgrel=1`. Bump only `pkgrel` when the PKGBUILD changes for the same
   release.
2. In each package directory, on Arch, refresh the checksums and metadata:

   ```sh
   updpkgsums
   makepkg --printsrcinfo > .SRCINFO
   ```

3. Build and check: `makepkg -si`, then `namcap PKGBUILD *.pkg.tar.zst`.
   Or run the "AUR packages" workflow from the Actions tab, which builds both
   in an Arch container. It builds `flow-desktop` from the checked-out commit
   instead of the tag.
4. Commit the changes here, then publish.

## Publishing

Each package is its own git repository on the AUR. With an SSH key added to
the AUR account:

```sh
git clone ssh://aur@aur.archlinux.org/flow-desktop-bin.git
cp packaging/aur/flow-desktop-bin/{PKGBUILD,.SRCINFO} flow-desktop-bin/
cd flow-desktop-bin
git add PKGBUILD .SRCINFO
git commit -m "Update to 0.1.0beta3"
git push
```

Do the same for `flow-desktop` with
`ssh://aur@aur.archlinux.org/flow-desktop.git`. The first push creates the
package. The AUR only accepts the `master` branch and rejects a push without a
`.SRCINFO`, so regenerate it whenever the PKGBUILD changes.
