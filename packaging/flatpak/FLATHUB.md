# Flathub submission checklist

For the owner. Flathub hosts each app in its own repository under the
Flathub organization, so the submission happens there, not in this repository.

## Before submitting

- [ ] The `nightly-flatpak` CI job builds a bundle, and `continue-on-error` is
      removed from it and from `flatpak-sources` in `.github/workflows/build.yml`.
- [ ] The bundle was installed and tested on at least one immutable distro
      (Fedora Silverblue or Bazzite) and on Ubuntu: playback (including H.264),
      music, downloads into the default and a custom folder, `flow://` links
      from the browser extension, sync pairing and notifications.
- [ ] The in-app updater stays off in the Flatpak. Flathub does not allow apps
      to update themselves: the app must not call the updater when `FLATPAK_ID`
      is set, and Settings must not offer "Check for updates" there.
- [ ] Screenshots are added to `io.github.flow_tube.Flow-Desktop.metainfo.xml`.
      Flathub's linter rejects metainfo without them. Use images at a fixed URL
      (for example `raw.githubusercontent.com` at a commit hash) with a caption
      each.
- [ ] The metainfo has a `<release>` entry for the version being submitted,
      newest first.
- [ ] The linter passes on the manifest and on a built repository:
      `flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest packaging/flatpak/io.github.flow_tube.Flow-Desktop.yml`
      and `flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo`.

## Submit

- [ ] Submit on GNOME 51, before GNOME 52 is released (around March 2027).
      GNOME 52 drops `webkit2gtk-4.1`.
- [ ] Fork `flathub/flathub` and create a branch from its `new-pr` branch.
- [ ] Add the manifest, with the `type: dir` source replaced by a `type: git`
      source pinned to the release tag and its commit hash.
- [ ] Add the three files from `scripts/flatpak-sources.sh`
      (`cargo-sources.json`, `node-sources.json`, `pnpm-release.json`) under
      `generated-sources/` next to the manifest. Generated sources live in the
      Flathub repository, not in this one; regenerate them from the release tag.
- [ ] Open the pull request against `new-pr`, titled
      `Add io.github.flow_tube.Flow-Desktop`, and answer the reviewers there.

## After acceptance

- [ ] Verify the `io.github.flow_tube` namespace on flathub.org by logging in
      with a GitHub account that is an admin of the Flow-Tube organization.
- [ ] For each release, update the tag, commit and generated sources in the
      Flathub repository, and add the release to the metainfo here.
