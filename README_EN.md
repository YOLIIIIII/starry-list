# Starry List · 星轨日历

UX3.0.4 preview: shared list geometry across appearances and complete calendar markers in short windows. Focus-stable frost is preserved; user acceptance is pending. [Layout comparison and limitations (Chinese)](docs/UX3_0_4_VISUAL_REVIEW.md) · [Validation](docs/VALIDATION.md).

A cozy offline desktop calendar and task list in lavender, pastel yellow and cream. V1.0 targets **Windows 10/11 x64**; Simplified Chinese is the default UI language.

New to the app? Read the [Chinese user guide](docs/USER_GUIDE.md), including a five-minute quick start.

[Development Roadmap](docs/ROADMAP.md) · [Product Backlog](docs/PRODUCT_BACKLOG.md) · [User Guide (Chinese)](docs/USER_GUIDE.md)

## Features

- **Overview:** Monday-first month calendar and a continuous seven-day agenda starting from the selected date. Empty dates stay compact; click a date's plus button to reveal its Enter-to-add field.
- **Focus:** compact rows open plain read-only details. Edit opens a separate drawer with a fixed header and save/cancel footer. The form and long text scroll independently. Saving successfully collapses the task; cancelling protects unsaved edits.
- Completion is independent of priority. Completed tasks move below unfinished tasks; reorder within a day and completion group with arrow buttons.
- Real local SQLite, versioned migrations, serialized writes, explicit errors, delete confirmation and undo. Draft details are saved before switching or normal application close; failed writes keep the editor open.
- Built-in official mainland China holidays and makeup workdays for 2026, plus separate personal day marks. Unknown years are clearly disclosed.
- Frameless Tauri window, resize, minimize, close, optional always-on-top, restored geometry and view. Background alpha 40–100%, opaque text and readable input surfaces, reduced-motion support.
- JSON export and validated transactional import. Merge preserves existing tasks and remaps duplicate IDs; replacement needs explicit confirmation.

The following captures are from the actual Windows Tauri/WebView2 application, using an isolated test database with sample tasks. See [validation record](docs/VALIDATION.md).

![Overview](docs/screenshots/overview.png)
![Focus](docs/screenshots/focus.png)

[Compact window](docs/screenshots/compact.png) · [Settings](docs/screenshots/settings.png)

[Edit drawer](docs/screenshots/editor.png) · [Compact editor](docs/screenshots/editor-compact.png)

## Install

Open this repository's GitHub **Releases**, choose the latest published version, and download the Windows x64 `-setup.exe` under **Assets**. No release has been published by this development task. The installer includes the WebView2 bootstrapper; installing a missing runtime may require internet. Daily application use is offline.

Unsigned builds may show Windows publisher or SmartScreen warnings. Check the source and publisher before installation. If transparency renders incorrectly, enable the solid-background setting; a native `opaque` installer is also produced by the release workflow.

## Develop and build

Requires Node.js 24 LTS (minimum 22.12), npm, Rust 1.90.0 with MSVC, Visual Studio C++ Build Tools, a Windows SDK, and WebView2 Runtime.

```powershell
npm ci
npm run tauri dev
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build
```

The standalone Vite browser does not connect to SQLite and displays a native-runtime requirement. It does not silently substitute fake persistence.

This workspace originally had Node 16. `scripts/desktop.ps1 dev` (or `check` / `build` / `build -Opaque`) selects the locally installed Node 24 and Cargo cache. Public contributors can use their normal installed toolchains.

NSIS artifacts are in `src-tauri/target/release/bundle/nsis/`. Build a native opaque fallback with:

```powershell
npm run tauri build -- --config src-tauri/tauri.opaque.conf.json
```

## Publish a GitHub Release

Push the repository to your own GitHub remote, pass CI, align the versions in package.json, Cargo.toml and tauri.conf.json, and update the changelog. Push a matching `v1.0.0` tag. The Windows release workflow runs checks and native tests, then uses the [official Tauri Action](https://v2.tauri.app/distribute/pipelines/github/) to create a **draft** with x64 NSIS transparent and opaque installers. Review assets and publish the draft manually. Code signing is not configured. Source commits and pushes do not constitute a release; tags and releases require separate explicit authorization.

## Architecture and privacy

React 19 / TypeScript / Vite / Tailwind 4, Lucide, date-fns and Zod provide the interface and validated calendar domain. Tauri 2 hosts the native window; the Rust `rusqlite` module owns a bundled SQLite connection so import, replacement and ordering use one real transaction. Official Window State and Dialog plugins manage desktop behavior.

`src/domain.ts` owns dates, task ordering and backup validation; `src/store.ts` serializes writes and shares data across views; `src/platform.ts` isolates desktop IPC; `src/components.tsx` implements task editing; `src-tauri/src/db.rs` owns migrations and persistence. Official holidays live in `src/holidays/2026.json`, with [government source metadata](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm).

The database is located at `%APPDATA%\app.starrylist.desktop\starry-list.db`, resolved by Tauri's application data API. SQLite uses WAL, full synchronization, foreign keys, parameterized statements and versioned transactional migrations. Newer databases are rejected by older builds. Backups include settings, tasks, categories and personal marks, not geometry. Imports are limited to 32 MB and checked in both frontend and backend. A merge preserves settings and existing day marks, and duplicate task IDs get new IDs; repeated imports can duplicate content. Replacement removes current content only after explicit confirmation and within a transaction. Export first.

No accounts, cloud services, telemetry, remote fonts or network icons. Data is unencrypted and protected by the operating system's user permissions. Export before uninstalling. Never commit your personal database or backup.

## Development Roadmap

See the [roadmap](docs/ROADMAP.md), [product backlog](docs/PRODUCT_BACKLOG.md) and [decision log](docs/DECISIONS.md) (Chinese). The Markdown backlog is the authoritative source for detailed requirements, priorities, states and acceptance criteria. Recording a request does not authorize implementation; no unassessed version scope or release date is promised.

UX3.0.1 extends SL-003 with persisted Reading / Light Glass / Dreamy Frosted appearances; Reading remains the default. Material and shell opacity (40–100%) are independent. Supported modern Windows can request Acrylic; unsupported or opaque windows use a readable fallback. Notification close buttons align right, preserving undo, five-second lifetime and pause behavior. Task text stays 14px and core interactions are retained. Visual acceptance remains In Review; see the [appearance comparison](docs/UX3_0_1_VISUAL_REVIEW.md) and [UX3.0 baseline](docs/UX3_VISUAL_REVIEW.md). SL-002 / SL-019 baseline behavior and SL-021 are Done, not formally released. SL-001 / SL-004-A remain In Review; other roadmap work requires separate authorization.

The initial V1.0 source is pushed. First-round UX changes are recorded separately in implementation commit [`23a7cd3`](https://github.com/YOLIIIIII/starry-list/commit/23a7cd3941a28d0724e254ca7b9bb71c9b8fd5c8); the backlog tracks subsequent acceptance decisions. There is no published GitHub Release. Planned capabilities are not implemented features.

## License

[MIT License](LICENSE). Copyright (c) 2026 yoli. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).
