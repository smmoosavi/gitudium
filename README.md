# Gitudium

A local, read-only Git history viewer. The repository adapter is implemented and tested; the UI still verifies connectivity to a typed tRPC API. Repository browsing and repository API routes are not implemented yet.

## Prerequisites

- Bun 1.3.14 or newer.
- Git 2.43.0 or newer (required for repository operations).

The foundation is validated on Linux with Bun 1.3.14 and Git 2.43.0. Older versions and other platforms have not been validated.

## Local development

```sh
pnpm install
pnpm run dev
```

Open <http://127.0.0.1:5173>. Vite serves React and proxies `/api/trpc` to the Bun server on `127.0.0.1:3000`, keeping browser requests same-origin. Both ports must be available. The page displays the response from the typed, input-validated health query. Use **Check connection** to refetch it.

Both servers watch their source files. Ctrl+C stops both processes. VS Code also provides development, typecheck, and artifact-build tasks.

```sh
pnpm run typecheck
bun test
pnpm run build
pnpm run test:artifact
```

## Repository adapter

[`GitRepositoryReader`](./src/repository/git.ts) implements the serializable [`RepositoryReader`](./src/repository/types.ts) contract. Discover from a launch directory, including subdirectories and linked worktrees, then request metadata, references, history, commit details, or diffs. Empty and bare repositories are supported.

History defaults to all refs plus HEAD in topological order, similar to `git log --oneline --decorate --graph --all`, with parent IDs available for graph rendering. Pages pin commit tips across ref changes; labels are refreshed from current refs. An optional revision limits history to that commit and its ancestors. Merge diffs use the first parent; root diffs use the empty tree. Rename detection is off (deletion/addition). Paths are literal repository-relative filenames. Diff results distinguish text, binary, and oversized output.

Limits: 50 commits per page by default (maximum 200), 4 concurrent Git subprocesses per reader, 4,096 history tips, 8 MiB ordinary output, and 1 MiB patches. Normalized errors cover invalid inputs, missing revisions, unavailable Git, failed commands, cancellation, excessive output, and concurrency saturation. No repository operations are exposed over HTTP yet.

```sh
bun test tests/repository.test.ts
pnpm run typecheck
```

## Single-file build and invocation

Building requires pnpm, Bun, and the installed project dependencies. `pnpm run build` builds the production frontend into `dist/`, embeds every asset as base64, and bundles the backend and its dependencies into one executable JavaScript file, `gitudium`, at the checkout root. Temporary generated modules are removed automatically. `pnpm run build:client` builds only the frontend.

Copy only `gitudium` to the destination; no `node_modules`, `dist/`, package installation, or checkout is needed at runtime. Bun must be available on `PATH` for the executable's shebang:

```sh
./gitudium
# Alternatively (including platforms without Unix shebang support):
bun ./gitudium
```

The artifact serves the UI and API together on `127.0.0.1` with an automatically assigned port and prints the browser URL. Open that URL manually. Ctrl+C or SIGTERM shuts down the server. It currently shows the connectivity UI, not repository history; repository API/UI integration, live updates, and per-launch API authentication remain later work in [the implementation plan](./plan.md).

`pnpm run test:artifact` checks the existing build from an isolated temporary directory containing only the copied artifact: startup, HTML, JavaScript/CSS loading, the health API, missing routes, and SIGTERM shutdown. Run it after building. Browser execution was also validated against the artifact: the UI rendered, the typed API connected, and **Check connection** successfully refetched.

The validated artifact is approximately **850 KiB (870,434 bytes)**; size varies with dependencies and frontend changes. Validation used Linux, Bun 1.3.14, and Git 2.43.0. The artifact requires Bun, and repository operations will require Git; it is not a native binary. Other platforms are unvalidated. If execution reports a missing interpreter, install Bun or invoke its absolute path. If copying loses executable permissions, use `chmod +x gitudium` or invoke it with Bun. Rebuild after source changes; the artifact never reads frontend files from disk.

The development servers bind only to loopback, but launch-token protection is not yet implemented. Use this foundation only for local development; it exposes no repository data or Git operations.
