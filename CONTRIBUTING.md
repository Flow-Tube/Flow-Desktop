# Contributing to Flow Desktop

Thanks for your interest in improving Flow Desktop — a privacy-respecting YouTube and YouTube Music client with a native, fully local recommendation engine, built with Rust, Tauri, React, and TypeScript.

This guide explains how to set up the project, the standards we hold code to, and how to get your changes merged. Contributions of every size are welcome, from typo fixes to new subsystems.

## Code of Conduct

This project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it. Please report unacceptable behavior through the channels described there.

## Ways to contribute

- **Report bugs** using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).
- **Request features** using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml).
- **Fix bugs or build features** by opening a pull request.
- **Improve documentation** — the README, this guide, code comments, and in-app copy.
- **Help with localization** — translation strings live in [`src/lib/i18n/strings.json`](src/lib/i18n/strings.json).
- **Report security issues** privately as described in [SECURITY.md](SECURITY.md) — please do **not** open a public issue for vulnerabilities.

## Before you start

- Search [existing issues](https://github.com/Flow-Tube/Flow-Desktop/issues) and pull requests first to avoid duplicates.
- For anything beyond a small fix, open an issue (or comment on an existing one) to discuss the approach **before** writing code. This avoids wasted effort on changes that may not be a good fit.
- Keep pull requests focused. One logical change per PR is far easier to review and merge than a large, mixed one.

## Development environment

### Requirements

- **Node.js** 22.12 or newer
- **pnpm** 11.9 or newer (this project uses pnpm, not npm or yarn)
- **Rust** (stable toolchain)
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

On Linux you also need a compatible glibc, GTK 3, and WebKitGTK 4.1 environment.

### Setup and run

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm tauri dev` launches the full desktop app with hot reload for the frontend. Use `pnpm dev` if you only need the Vite frontend in a browser (note that Tauri-only features fall back to mocks outside the native shell).

### Build

```sh
pnpm test          # frontend unit tests (Vitest)
pnpm build         # type-check + production frontend build
pnpm tauri build   # build native packages for the current OS
```

Windows, Linux, and macOS packages are produced natively by the GitHub Actions release workflow.

## Project structure

```
src/                  React + TypeScript frontend
  components/         UI primitives (ui/) and smart domain components ([domain]/)
  pages/              Top-level routed views
  store/              Zustand global state
  lib/                Hooks, API wrappers, i18n, and other non-UI logic
  locales/            Localization resources
  types/              Shared TypeScript types
src-tauri/            Rust backend (Tauri 2)
  src/commands/       Tauri command handlers exposed to the frontend
  src/db/             SQLite access and migrations
  src/flow_neuro/     Local video recommendation engine
  src/music_brain/    Local music recommendation engine
  src/streaming/      Media extraction and the loopback media proxy
  src/security/       Validation and integrity (BotGuard/PO-token) handling
  migrations/         SQL migrations
Assets/               Brand and donation assets
public/               Static assets served by Vite
```

## Coding guidelines

### Frontend (React / TypeScript / Tailwind)

The UI follows a strict design system. **Read [Design.md](Design.md) before writing or modifying any React or Tailwind code** — it is the source of truth for our look and feel. In short:

- No gradients, glassmorphism/`backdrop-blur`, drop shadows, colored borders, or arbitrary hex codes. Use the CSS variables defined in [`src/App.css`](src/App.css) (e.g. `var(--color-primary)`, `bg-surface-container`).
- Keep `components/ui/` primitives "dumb" — props in, events out, no data fetching. Put data-fetching containers in `components/[domain]/` and compose them in `pages/`.
- Abstract all backend communication (`invoke(...)`, `fetch(...)`) into custom hooks or modules under `src/lib/` — never inside a component's `useEffect`.
- Use Zustand (`src/store/`) for global state; local component state only for transient UI toggles.
- Do not hardcode user-facing strings. Add them to [`src/lib/i18n/strings.json`](src/lib/i18n/strings.json) and read them via `getString(...)`.
- Prefer optimistic UI for local database actions, and debounce calls to the Innertube client to avoid `429` rate limits.

### Backend (Rust)

- Validate all untrusted input (search terms, video/channel/browse IDs, continuation tokens) before making network requests.
- Keep media access behind the tokenized loopback proxy; do not expose public local servers.
- Do not introduce new broad Tauri permissions, secrets, telemetry, or analytics.
- Run `cargo fmt` and address `cargo clippy` warnings before submitting.

### General

- Match the style, naming, and comment density of the surrounding code.
- Keep privacy and security front of mind — Flow contains no advertising or analytics SDK, requires no account, and stores user data locally. Contributions must preserve these guarantees.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). Existing history uses prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `CI:`, optionally with a scope:

```
feat(Music): implement endless radio playback
fix(player): correct subtitle offset on seek
docs: clarify Linux build requirements
```

Write clear, imperative subject lines and explain the *why* in the body when it is not obvious.

## Testing and quality checks

Run the same checks CI runs before opening a PR:

```sh
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

Add or update tests when you change behavior, and smoke-test the affected desktop behavior in `pnpm tauri dev`.

## Submitting a pull request

1. Fork the repository and create a branch from `main` (e.g. `feat/endless-radio` or `fix/subtitle-offset`).
2. Make your changes following the guidelines above.
3. Run the testing and quality checks and ensure they pass.
4. Push your branch and open a pull request against `main`.
5. Fill out the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) completely, including the validation checklist and **screenshots or recordings for any visible UI change**.
6. Link related issues with `Closes #123` where applicable.
7. Respond to review feedback. Maintainers may request changes before merging.

Please confirm that your PR introduces no new secrets, private data, telemetry, or broad permissions, and that dependency/lockfile changes are intentional and minimal.

## Supporting the project

Flow is free and open-source software maintained by an independent developer. If you would like to support development financially, you can do so through [Patreon](https://patreon.com/A_EDev) or via cryptocurrency — see the **Support & donations** section of the [README](README.md#support--donations), or the in-app **Support Flow** page. Always verify any crypto address and network before sending.

## License

Flow Desktop is licensed under the [GNU General Public License v3.0](LICENSE). By contributing, you agree that your contributions will be licensed under the same terms.
