# Gitudium

A local, read-only Git history viewer, currently at the project-foundation milestone. The UI verifies connectivity to a typed tRPC API; repository browsing is not implemented yet.

## Prerequisites

- Bun 1.3.14 or newer.
- Git 2.43.0 or newer (required for the upcoming repository adapter).

The foundation is validated on Linux with Bun 1.3.14 and Git 2.43.0. Older versions and other platforms have not been validated.

## Local development

```sh
bun install
bun run dev
```

Open <http://127.0.0.1:5173>. Vite serves React and proxies `/api/trpc` to the Bun server on `127.0.0.1:3000`, keeping browser requests same-origin. Both ports must be available. The page displays the response from the typed, input-validated health query. Use **Check connection** to refetch it.

Both servers watch their source files. Ctrl+C stops both processes. VS Code also provides development, typecheck, and frontend-build tasks.

```sh
bun run typecheck
bun test
bun run build
```

The build currently outputs frontend assets to `dist/`; it is not yet the standalone `gitudium` artifact. Single-file packaging, repository discovery, live updates, and per-launch API authentication are later milestones in [the implementation plan](./plan.md).

The development servers bind only to loopback, but launch-token protection is not yet implemented. Use this foundation only for local development; it exposes no repository data or Git operations.
