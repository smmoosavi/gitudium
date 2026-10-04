# Gitudium

A local, read-only Git history viewer with paginated history, reference selection, commit details, changed-file navigation, and on-demand text diffs. Binary, oversized, empty, loading, and failure states are explicit. Live repository updates refresh active history after commits, branch switches, and ref changes. A per-launch access token and strict local request boundaries protect the API and live stream.

The interface uses a JetBrains-inspired dark workspace with compact log rows, reference badges, status-colored changed files, and highlighted unified diffs. The status bar shows live-update connectivity. Use **Layout** to choose three columns (log, files, diff), a log on the left with files above the diff, or log and files above a full-width diff. Each pane scrolls independently. Drag either divider to resize panes, or focus it and use Left/Right for vertical dividers and Up/Down for horizontal dividers (Home/End jump to the limits). Double-click a divider to restore its default size. The selected layout and each layout’s pane sizes persist in browser localStorage; blocked storage falls back to in-memory preferences. Switching layouts preserves the selected commit and file. Narrow screens retain the selected layout. Use **Diff view** in the file-diff heading to choose unified or side-by-side rendering; this preference also persists in localStorage. Side-by-side aligns old/new lines with line numbers and independently scrollable horizontal panes. Added and deleted files always use the full-width unified view, without changing the saved preference. Binary and oversized diffs retain their existing status messages.

## Installation

This project is not published to npm. Each [GitHub Release](https://github.com/smmoosavi/gitudium/releases/latest) ships a single `gitudium` executable artifact with its runtime dependencies and frontend assets bundled.

Download `gitudium` from the latest release, make it executable, and run it inside the Git repository to browse:

```sh
chmod +x ./gitudium
./gitudium
```

Open the full browser URL printed at startup, including its `#token=…` fragment. The artifact requires Bun and Git; it is executable JavaScript, not a native binary. No npm installation, project checkout, or adjacent assets are needed. Alternatively, run it with `bun ./gitudium`.

## Prerequisites

- Bun 1.3.14 or newer.
- Git 2.43.0 or newer (required for repository operations).
- pnpm 11.17.0 and Node.js 24 for development and building from source.

The foundation is validated on Linux with Bun 1.3.14 and Git 2.43.0. Older versions and other platforms have not been validated.

## Local development

```sh
pnpm install
pnpm run dev
```

Open the full `http://127.0.0.1:5173/#token=…` URL printed by the development server. Vite serves React and proxies `/api` to the Bun server on `127.0.0.1:3000`, keeping browser requests same-origin. Both ports must be available. The server captures its launch working directory and discovers that repository lazily. Select a reference (all refs plus HEAD by default), select a commit, then select a changed file to view its diff. **Load more commits** appends 50-commit pages when available; failed queries offer **Retry**. Live updates preserve the selected reference, commit, and file, while restarting history at its first page. The connection indicator reports disconnects; automatic SSE reconnect reconciles missed changes.

Both servers watch their source files. Ctrl+C stops both processes. VS Code also provides development, typecheck, and artifact-build tasks.

```sh
pnpm run typecheck
bun test
pnpm run build
pnpm run test:artifact
```

## CI and releases

[CI and Release](./.github/workflows/ci-release.yml) runs on pull requests, pushes to `main`, and all tag pushes. It installs dependencies from the frozen pnpm lockfile, checks TypeScript, runs tests, builds the single-file artifact, and smoke-tests it in an isolated repository.

To publish a release, push a tag such as `v0.1.0`. Only after verification succeeds does the workflow create a GitHub Release with generated release notes and the single `gitudium` asset. It does not publish to npm. Downloaded assets may need `chmod +x` before execution.

## Repository adapter

[`GitRepositoryReader`](./src/repository/git.ts) implements the serializable [`RepositoryReader`](./src/repository/types.ts) contract. Discover from a launch directory, including subdirectories and linked worktrees, then request metadata, references, history, commit details, or diffs. Empty and bare repositories are supported.

History defaults to all refs plus HEAD in topological order, similar to `git log --oneline --decorate --graph --all`, with parent IDs available for graph rendering. Pages pin commit tips across ref changes; labels are refreshed from current refs. An optional revision limits history to that commit and its ancestors. Merge diffs use the first parent; root diffs use the empty tree. Rename detection is off (deletion/addition). Paths are literal repository-relative filenames. Diff results distinguish text, binary, and oversized output.

Limits: 50 commits per page by default (maximum 200), 4 concurrent Git subprocesses per reader, 4,096 history tips, 8 MiB ordinary output, and 1 MiB patches. Normalized errors cover invalid inputs, missing revisions, unavailable Git, failed commands, cancellation, excessive output, and concurrency saturation. The typed API exposes only metadata, references, history, commit, and diff queries, with runtime validation and normalized repository errors.

```sh
bun test tests/repository.test.ts
pnpm run typecheck
```

## Live updates

One `/api/events` SSE stream supplies invalidation events. Resolved Git/common directories are watched with a 100 ms coalescing window; a 2-second bounded fingerprint check covers HEAD, loose/custom refs, packed refs, and reftable metadata even when watchers are unavailable. Polling never launches Git or scans object/log directories. Refreshes are serialized and coalesced; metadata and references refresh before history restarts at its first page. Commit details and file diffs remain cached by immutable commit ID. A removed selected reference stays visible as unavailable rather than silently switching filters.

Reconnect sends an initial invalidation to reconcile missed changes. Disconnects keep the existing view visible with a stale-data warning. Shutdown closes watchers, timers, and streams; Bun's idle timeout is disabled for long-lived SSE connections. Working-tree-only edits are not monitored.

## Single-file build and invocation

Building requires pnpm, Bun, and the installed project dependencies. `pnpm run build` builds the production frontend into `dist/`, embeds every asset as base64, and bundles the backend and its dependencies into one executable JavaScript file, `gitudium`, at the checkout root. Temporary generated modules are removed automatically. `pnpm run build:client` builds only the frontend.

Copy only `gitudium` to the destination; no `node_modules`, `dist/`, package installation, or checkout is needed at runtime. Bun must be available on `PATH` for the executable's shebang:

```sh
./gitudium
# Alternatively (including platforms without Unix shebang support):
bun ./gitudium
```

The artifact serves the UI and API together on `http://127.0.0.1:9171/` by default and prints the browser URL. If the port is occupied, startup fails rather than silently choosing another port. Use `--port` or `GITUDIUM_PORT` to override it; explicitly selecting port `0` requests an automatically assigned port. Open that full URL manually, including its `#token=…` fragment. Ctrl+C or SIGTERM shuts down the server. By default it browses the current directory (subdirectories and linked worktrees are supported). Outside a repository, the UI reports a clear error. Packaging and access protection are validated as recorded in [the implementation plan](./plan.md).

### Command-line options and environment

```sh
./gitudium --help
./gitudium --version
./gitudium --port 8080 /path/to/repository
./gitudium -p 8080 -d /path/to/repository
GITUDIUM_PORT=8080 GITUDIUM_DIRECTORY=/path/to/repository ./gitudium
```

| Option | Environment | Default |
| --- | --- | --- |
| `-h`, `--help` | — | Print usage and exit |
| `-v`, `--version` | — | Print package version and exit |
| `-p`, `--port <port>` | `GITUDIUM_PORT` | `9171` |
| `-d`, `--directory <path>` or positional directory | `GITUDIUM_DIRECTORY` | Current directory |

Command-line values override environment values. Relative paths resolve against the launch working directory. Use either `--directory` or a positional directory, not both; `--` allows positional paths beginning with a dash. Ports must be integers from 0 through 65535. Unknown options, missing values, invalid ports, and nonexistent/non-directory paths exit with status 1; help and version exit with status 0 without starting a server. Binding remains loopback-only; there is no public-host option.

Development accepts the same options via `pnpm run dev --port 3001 /path/to/repository` or `pnpm run dev:server --port 3001 --directory /path/to/repository`. Its backend defaults to port 3000 and requires a nonzero port; the browser remains on port 5173. The combined development launcher automatically configures Vite's API proxy for the chosen backend port. When running `dev:server` and `dev:client` separately, set the same `GITUDIUM_PORT` for both.

`pnpm run test:artifact` checks the existing build from an isolated disposable Git repository with the copied artifact and no adjacent assets or runtime packages: startup, HTML, JavaScript/CSS loading, health and repository queries, a file diff, authenticated SSE invalidation following an external commit, unauthenticated/wrong-token/Host/Origin rejection, missing routes, and SIGTERM shutdown. Run it after building. The development browser flow is verified through reference selection, commit selection, changed-file navigation, and diff rendering.

The validated artifact is approximately **876 KiB (897,496 bytes)**; size varies with dependencies and frontend changes. Validation used Linux, Bun 1.3.14, and Git 2.43.0. The artifact requires Bun and Git; it is not a native binary. Other platforms are unvalidated. If execution reports a missing interpreter, install Bun or invoke its absolute path. If copying loses executable permissions, use `chmod +x gitudium` or invoke it with Bun. Rebuild after source changes; the artifact never reads frontend files from disk.

## Local access protection

Each launch generates a random 256-bit token. The printed URL carries it in a fragment (not sent to the server); the UI removes the fragment immediately and stores the token in tab-scoped `sessionStorage` so reloads work. A fresh tab needs the full launch URL. Browsers may copy session storage when duplicating a tab or opening one with an opener; this is browser behavior, not strong isolation between tabs. If storage is blocked, access works in memory until reload. Server restart rotates the token; reopen the new printed URL if authentication fails.

All API requests, including health and SSE, require a Bearer header. SSE uses streaming fetch so the token never appears in request URLs. Servers reject unexpected Host, Origin, and cross-site fetch metadata before routing; packaged requests must use the exact printed loopback origin. Development additionally permits the fixed Vite origin, and the launcher keeps the token stable across backend watch restarts. API responses disable caching and responses use a no-referrer policy. Tokens are not written to disk by the application; session storage is the explicitly chosen browser-side exception to otherwise nonpersistent application data.

Keep the launch URL private. Access protection does not isolate repository contents from other processes, browser extensions, or users with access to the same local machine/browser. Use trusted repositories and do not expose or forward its ports.
