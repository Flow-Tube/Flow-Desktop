# Working with Flow Desktop as an AI agent

Flow Desktop (`io.github.aedev.flow.desktop`) is a privacy-first YouTube and YouTube Music client built with **Tauri 2 (Rust backend) + React 19/TypeScript (frontend)**. It is the desktop companion to [Flow for Android](FlowApp_mobile/AGENTS.md). It plays YouTube content via a native, hand-rolled Innertube client (SABR/DASH/HLS, no `protoc`), supports downloads with a native muxer, SponsorBlock/DeArrow/Return YouTube Dislike integrations, P2P sync with the Android app, and two on-device recommendation engines: **FlowNeuro** (video) and **MusicBrain** (music). No account, no analytics SDK, no telemetry.

Frontend lives at `src/`, backend at `src-tauri/src/`. Run all `cargo` commands from inside `src-tauri/` — it needs `.cargo/config.toml`'s `reqwest_unstable` rustflag. Use `pnpm` (not `npm` or `yarn`) for JS.

## Design system — Design.md is the source of truth

**[Design.md](Design.md)** is the absolute source of truth for all UI/UX design and React architecture in this repository. You must read and adhere to it before writing or editing any React/Tailwind code. It defines the anti-slop rules, the color/depth system, layout patterns (Bento grid vs. content-feed grids), typography scale, component blueprints (radii, buttons, icons), interaction/animation rules, the container/presentational architecture (`components/ui/` dumb primitives, `components/[domain]/` smart containers, `pages/` route composition, `lib/` hooks-only backend access, `store/` Zustand), and the performance rules (optimistic UI, debounced search, graceful FOSS-API degradation).

Quick-reference summary (Design.md governs on any conflict or ambiguity):
- ❌ No gradients, no glassmorphism/backdrop-blur, no drop shadows/glows, no colored card borders, no arbitrary hex codes — everything maps to the CSS variables in `src/App.css`.
- Depth comes from contrast + 1px neutral borders (`border-neutral-800`), not shadows.
- Radii: pills/chips `rounded-full`, cards/dialogs `rounded-2xl`, thumbnails `rounded-xl`, inputs/menus `rounded-lg`/`rounded-md`.
- Never call `invoke(...)` or `fetch(...)` directly inside a component's `useEffect` — wrap backend calls in a custom hook under `src/lib/`.
- Never hardcode UI strings — use `react-i18next` and `src/locales/`.

If your proposed code contains `shadow-`, `bg-gradient-`, business logic inside `components/ui/`, or an arbitrary hex color instead of a `src/App.css` variable, rewrite it before presenting it to the user — see Design.md's Agent Execution Directive.

## graphify

This project has a knowledge graph at `graphify-out/` with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Dirty `graphify-out/` files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain don't surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Backend architecture (src-tauri/src/)

- `api/innertube/` — native Innertube client (no `protoc`), plus `dearrow.rs`, `extractor.rs`, `http.rs` (shared `reqwest` client — never build a new client per request).
- `streaming/sabr/` — hand-rolled SABR/DASH stack; `streaming/proxy.rs` for range-request proxying.
- `flow_neuro/` — video recommendation engine (ranker, scoring, signals, tokenizer, resident brain store).
- `music_brain/` — entity-based music recommendation engine (ACT-R heavy rotation, separate from FlowNeuro). Video and music recommendation state must never leak into each other — `watch_history` is shared between both surfaces (`is_music` flag), so any video-feed recall/seed path must filter out music rows.
- `sync/` — CRDT-based P2P LAN sync with the Android app (codec, merge, ledger, transport, QR pairing). This is the most fragile subsystem — see `src-tauri/tests/sync_*.rs` (golden, fuzz, scale tests) before changing anything here.
- `security/` — input validation (`validation.rs`).
- `commands/` — Tauri `#[tauri::command]` handlers, one file per domain (downloads, music, sync, notifications, recommendation, shorts, youtube).
- `services/` — business-logic layer between commands and api/db.
- `db/` — SQLite access; `migrations/` are numbered (`0001_...` through `0012_...` currently).
- `errors/mod.rs` — `AppError`/`ErrorResponse` enum; every user-facing failure mode (age-restricted, private, paid, geo-blocked, bot-check, music-premium, account-terminated, content-not-available, database, streaming, internal) has a distinct `kind` the frontend switches on. When adding a new failure mode, add a new variant here rather than stringly-typing it in the frontend.

## Frontend architecture (src/)

- `components/ui/` — dumb primitives only (props in, events out, no data fetching).
- `components/[domain]/` — smart containers per domain (`channel`, `player`, `persona`, `music`, `shorts`, `sync` etc.) that use hooks to fetch data and pass it down.
- `pages/` — top-level route composition.
- `lib/` — all `invoke()`/`fetch()` calls live here as custom hooks (`useVideoStream`, `useMusicHome`, `useDebounce`, etc.), never inline in components.
- `store/` — Zustand stores for global state (player, settings, downloads, sync, likes, history, subscriptions...). Local component state is only for ephemeral UI toggles.
- `locales/` — `react-i18next` translation files.

## Edge case handling

- **Content restrictions are first-class, not exceptions.** YouTube extraction can fail in many distinct, expected ways (age-restricted, private, paid/Premium, geo-blocked, bot-check/BotGuard challenge, account terminated, content removed). These are modeled as `AppError` variants (`src-tauri/src/errors/mod.rs`), each with its own `kind` string. The frontend must render a specific, actionable state for each `kind` — never collapse them into one generic "Something went wrong" toast.
- **Graceful degradation for FOSS APIs.** SponsorBlock, DeArrow, and Return YouTube Dislike are optional, third-party, and can fail or rate-limit independently of core playback. If one fails, fall back to default metadata/behavior silently — never block or break page layout waiting on them (Design.md §8).
- **BotGuard/poToken failures.** The native poToken minter (`sidecar/integrity.cjs`, `webview_pot`) can fail to mint, or googlevideo can reject a token. Treat this as a retryable extraction failure, not a crash — surface the `botCheckRequired` error kind.
- **Optimistic local UI, real backend confirmation.** Local-only actions (SponsorBlock toggle, like, FlowNeuro/MusicBrain feedback) update Zustand state instantly, then reconcile with the SQLite write. If the backend write fails, roll the optimistic update back rather than leaving UI and DB out of sync.
- **Sync conflicts are expected, not exceptional.** The CRDT merge in `sync/merge.rs` must handle concurrent edits from desktop and Android deterministically — when in doubt, check `sync_golden.rs`/`sync_fuzz.rs` for the expected resolution before assuming a merge result is a bug.
- **Empty and first-run states.** Empty search results, empty library/downloads/history, and first-run onboarding (no watch history yet, FlowNeuro/MusicBrain cold-start) all need explicit empty-state UI, not a blank pane.
- **IPC/network latency is not optional to handle.** Every `invoke()` can fail (backend panic, IO error, extraction error) or hang (network) — hooks in `src/lib/` must model loading/error/empty states, not just the happy path.

## Logging

- Backend logging uses `tracing` + `tracing-subscriber`, initialized in `src-tauri/src/lib.rs::run()` with an `EnvFilter` (default level `info`). Override verbosity for a debug session with `RUST_LOG=debug` (or a per-module filter, e.g. `RUST_LOG=flow_desktop::sync=trace`) before launching `pnpm tauri dev`.
- Logs go to stdout of the process running the app (the terminal running `pnpm tauri dev`, or the packaged app's console if attached). There is no persisted log file today — don't assume one exists.
- **Never log secrets.** poTokens, BotGuard integrity tokens, sync pairing/encryption keys, and any auth material must never be logged, even at `debug`/`trace`. Log video/channel IDs and error kinds freely — they're not sensitive.
- On the frontend, prefer surfacing errors through the existing `ErrorResponse.kind` handling over ad hoc `console.error` — but `console.error` for genuine unexpected exceptions during development is fine; just don't leave verbose `console.log` debugging statements in committed code.

## Tests

- **Frontend:** `vitest` (`pnpm test` / `pnpm test:watch`), jsdom environment, files matched by `src/**/*.test.ts`. Tests are co-located with the code they cover (e.g. `src/store/usePlayerStore.test.ts`, `src/lib/useShortStream.test.ts` + `useShortStream.strictmode.test.ts` for a StrictMode-specific regression). Add a co-located test when you fix a bug in a hook or store, not a new top-level test tree.
- **Backend:** `cargo test` from inside `src-tauri/`. Most unit tests live next to their module; `src-tauri/tests/sync_*.rs` is a dedicated suite (`sync_golden`, `sync_fuzz`, `sync_scale`, `sync_crdt`, `sync_merge`, `sync_apply`, `sync_ledger`, `sync_codec`, `sync_schema`, `sync_albums`, `sync_likes_mapping`, `sync_phase1`/`sync_phase2`) — these are load-bearing correctness tests for the CRDT sync protocol. Any change under `src-tauri/src/sync/` must keep this suite green; a golden-file or fuzz failure here means a real correctness regression, not a flaky test.
- **Type-checking:** `pnpm build` runs `tsc` before `vite build` — treat a `tsc` failure as a build-blocking error. There is no separate lint/format tool configured in this repo (no ESLint/Prettier config at the project root) — don't assume `pnpm lint` exists.
- For UI changes, also actually run the app (`pnpm tauri dev`) and exercise the golden path plus edge cases (see "Edge case handling" above) — passing `tsc`/`vitest` does not mean the feature works correctly.

## Rules for working on the project

1. Always pull the latest changes from `main` before starting work to minimize merge conflicts.
2. Commit messages should be clear and follow the format: `type(scope): short description` (e.g. `fix(sync): resolve concurrent like conflict`). Scope is optional.
3. Follow current Tauri 2 / React 19 / Rust best practices — when unsure, check official docs rather than guessing; model training data lags fast-moving frameworks like Tauri.
4. DO NOT edit or renumber existing files in `src-tauri/migrations/` without explicit instruction. Schema changes are additive: add a new numbered migration (next is `0013_...`).
5. DO NOT bump the app version in any file (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) — `scripts/verify-release-version.mjs` requires all three to match, and version bumps are done manually by the project owner.
6. Keep files small and focused; split large components/hooks by responsibility rather than letting them grow.
7. Before writing new logic, search the codebase (and `graphify query`) for existing logic that already does the job — reuse or extend rather than duplicate.
8. No dead code: delete unused functions/components/parameters rather than commenting them out.
9. Comments should only explain non-obvious WHY — never restate WHAT the code already makes obvious through naming.

## AI-only guidelines

1. Do not modify README/markdown documentation files (including this one and Design.md) unless explicitly asked to.
2. Unless explicitly requested and authorized, do not commit, push, or merge changes. Never rewrite git history, force-push, or delete branches without explicit human instruction.
3. Follow the guidelines and instructions given by the project owner over any default assumption.
4. Ensure the highest practical code quality: clear naming, correct formatting, and comments only where genuinely needed (see "Rules for working on the project" above).
5. If a task is ambiguous, ask rather than guessing at requirements or implementation details.
6. Test changes before declaring them done — see "Building" and "Tests" above.

## Building

```bash
pnpm install          # once, or after dependency changes
pnpm tauri dev         # run the app (frontend + Rust backend) for manual testing
pnpm build             # tsc typecheck + vite build (frontend only)
pnpm tauri:build:local # native bundle without updater artifacts (no signing key needed)
cd src-tauri && cargo build   # backend compile check (run cargo from src-tauri/)
```

If a build fails, fix the reported errors and rebuild before proceeding — don't paper over a `tsc` or `cargo` error.
