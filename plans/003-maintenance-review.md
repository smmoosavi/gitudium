# Prioritized maintenance recommendations

Review date: 2026-10-09

## Assessment and baseline

The codebase has a solid foundation: typed API boundaries, an injectable Git runner, bounded resource usage, pure frontend helpers, and substantial regression coverage. Prefer targeted improvements over a broad rewrite.

Baseline verified during the review:

- `pnpm run typecheck` passed.
- `pnpm test`: 186 tests passed across 29 files.
- `pnpm run build` passed.
- `pnpm run test:artifact` passed, including isolated startup, assets, repository API, live invalidation, and SIGTERM shutdown.
- Local validation used Bun 1.4.0; CI pins Bun 1.3.14. Local success does not replace validation on the pinned runtime.

The recommendations below retain the original review findings; implementation updates are recorded separately under each item. Items 1–2 described reproducible injected failure-path bugs; the remaining items are maintenance opportunities, not confirmed production regressions.

## 1. Make Git process cleanup unconditional

**Priority: High — correctness and resource lifetime.**

### Evidence

In [runner.ts](../src/repository/runner.ts), process termination and exit waiting precede releasing the concurrency slot. If termination throws or the exit promise rejects, the slot can leak. Repeated failures can leave subsequent requests returning `BUSY`. A read-only injected probe reproduced slot exhaustion after rejected exit waits.

### Safe implementation

1. Add regression tests in [git-runner.test.ts](../tests/git-runner.test.ts) for throwing termination, rejected exit waits, and delayed stream completion.
2. Put concurrency-slot release in an unconditional inner `finally`.
3. Define whether cleanup errors preserve or replace the original error; prefer preserving the primary failure while making secondary cleanup failures observable.
4. Ensure output collectors settle and listeners and stream locks are released on every exit path.
5. Retain the existing `GitRunner` and `GitSpawn` abstraction rather than replacing process management wholesale.

### Acceptance criteria

- A cleanup failure cannot permanently consume a concurrency slot.
- Cancellation, timeout, output-limit, and listener-cleanup tests still pass.
- Later commands can run after each injected failure.

### Implementation update — 2026-10-09

Completed. Concurrency slots now release in an unconditional inner `finally`. Cancellation and output limits interrupt exit waiting even when termination throws; collectors are cancelled and settled, stream locks are released, and abort listeners are removed. Primary errors are preserved, with secondary cleanup failures reported through `console.warn`. When termination throws, cleanup cannot guarantee OS-level process termination and does not wait indefinitely for that process to exit.

Regression coverage includes throwing termination, rejected exit waits, delayed cancellation and output completion, timeout, and slot reuse after failures. Validation: `pnpm test tests/git-runner.test.ts tests/repository.test.ts` passed (32 tests); `pnpm run typecheck` passed on Bun 1.4.0.

## 2. Isolate monitor subscriber exceptions

**Priority: High — correctness and shutdown reliability.**

### Evidence

In [monitor.ts](../src/repository/monitor.ts), notification exceptions can be treated as fingerprint failures. Initial subscription registers a listener before invoking it, and shutdown invokes listeners before clearing them. A throwing callback can remain registered or interrupt cleanup. An injected probe reproduced interrupted shutdown and retained listeners.

### Safe implementation

1. Add tests in [monitor.test.ts](../tests/monitor.test.ts) with one throwing subscriber and one healthy subscriber.
2. Separate fingerprint reconciliation errors from notification delivery errors.
3. Define callback-error handling explicitly so one subscriber cannot prevent delivery to others.
4. Roll back registration if the initial callback fails.
5. Ensure shutdown clears listeners and releases monitoring resources regardless of callback outcomes.

### Acceptance criteria

- Healthy subscribers continue receiving events when another subscriber throws.
- Notification failures do not cause duplicate reconciliation notifications.
- Failed initial subscription does not leave a listener registered.
- Shutdown remains idempotent and preserves watcher/polling fallback behavior.

### Implementation update — 2026-10-09

Completed. Fingerprint failures and notification delivery now use separate error boundaries. Change and shutdown callbacks are isolated per subscriber, with failures reported through `console.warn` so healthy subscribers still receive events. Initial callback failures propagate to the caller and roll back newly added registrations. Shutdown clears listeners in `finally`, and reentrant shutdown remains idempotent.

Validation: `pnpm test tests/monitor.test.ts` passed (15 tests), including throwing subscribers during normal changes, fingerprint failures, initial subscription, and shutdown, plus existing watcher, polling, fallback, and SSE cleanup coverage. `pnpm run typecheck` passed on Bun 1.4.0.

## 3. Add mounted browser coverage before restructuring UI state

**Priority: High maintenance value — prerequisite for safer UI refactoring.**

### Evidence

Selection, virtualized-row focus, scrolling, and keyboard navigation cross [main.tsx](../src/client/main.tsx), [CommitList.tsx](../src/client/CommitList.tsx), and [CommitView.tsx](../src/client/CommitView.tsx). Existing helper tests cover coordination, and [history-pane.test.tsx](../tests/history-pane.test.tsx) uses static rendering, but neither verifies the complete mounted interaction chain. The [artifact smoke test](../scripts/smoke.ts) checks HTTP behavior and assets rather than browser rendering.

### Safe implementation

1. Separate the importable app component from bootstrap without changing runtime behavior.
2. Add a small browser integration suite with deterministic API fixtures.
3. Cover offscreen keyboard selection, files-to-diff focus, pagination failure/retry, reference changes, and live refresh while viewing older details.
4. Retain pure-function tests; browser coverage should supplement rather than replace them.
5. Reorganize state ownership only after these tests establish current behavior.

### Acceptance criteria

- Tests exercise actual focus, scrolling, and virtualized selection.
- Fixtures avoid timing-dependent repository changes and arbitrary sleeps.
- Tests cover both successful interactions and recovery paths.

### Implementation update — 2026-10-09

Completed. The importable `App` now lives in [App.tsx](../src/client/App.tsx); bootstrap retains the same StrictMode, QueryClient configuration, token gate, and stylesheet. No UI state ownership was reorganized.

Added five mounted Chromium integration tests in [app.browser.ts](../browser/app.browser.ts), using deterministic tRPC route fixtures and a controlled streaming SSE response through the real client parser. They verify offscreen keyboard selection with actual focus, viewport geometry, scrolling, and virtualized row removal; files-to-diff focus and scroll reset; failed pagination retaining rows and retrying the identical cursor; reference changes resetting selection; and live invalidation resetting paginated history without replacing older details, refetching immutable detail queries, or stealing diff focus/scroll position. Assertions await observable states, with no arbitrary sleeps. Browser filenames remain outside Bun test discovery; existing pure tests are unchanged.

Validation: `pnpm run test:browser` passed (5 tests), `pnpm test` passed (201 tests across 30 files), `pnpm run typecheck`, `pnpm run build`, and `pnpm run test:artifact` passed. Local runtime: Bun 1.4.0. Browser tooling is Playwright with Chromium; setup and the dedicated Vite port (5174) are documented in README. Coverage does not certify other browsers or real SSE transport/repository behavior; artifact smoke separately verifies real live invalidation. CI's pinned Bun 1.3.14 was not exercised locally.

## 4. Unify development and packaged server startup

**Priority: Medium — reduce behavioral drift and untyped generated logic.**

### Evidence

Startup, request protection, and shutdown are duplicated between [index.ts](../src/server/index.ts) and generated source inside [build.ts](../scripts/build.ts). Generated server logic is not checked as ordinary source by the existing TypeScript validation.

### Safe implementation

1. Extract a shared server factory with explicit options for development origins and asset serving.
2. Preserve intentional differences between development and packaged operation.
3. Reduce generated source to importing that factory and supplying embedded assets.
4. Make resource ownership and shutdown explicit; retain handler references in test fixtures and close them during teardown.
5. Keep the single-file distribution and CLI contract unchanged.

### Acceptance criteria

- Development startup and proxy behavior remain unchanged.
- Packaged asset routing, protected API requests, and SIGTERM shutdown pass.
- The artifact still runs outside the checkout with only Bun and Git available.

## 5. Keep syntax highlighting services alive across commit changes

**Priority: Medium — preserve worker initialization and bounded cache reuse.**

### Evidence

[main.tsx](../src/client/main.tsx) keys the commit view by commit. [useSyntaxHighlighting.ts](../src/client/useSyntaxHighlighting.ts) creates and disposes its service with that component. Switching commits therefore terminates the worker and discards the bounded cache in [syntaxService.ts](../src/client/syntaxService.ts).

### Safe implementation

1. Establish mounted UI coverage from item 3 first.
2. Own the service at viewer scope and pass it to the highlighting hook.
3. Preserve commit-local context and selection resets.
4. Retain per-request cancellation and stale-result rejection.
5. Test rapid commit switching, return-to-commit cache reuse, StrictMode cleanup, and disposal when the viewer unmounts.

### Acceptance criteria

- Switching commits does not recreate the service unnecessarily.
- Older responses cannot update the newly selected file.
- Cache bounds remain enforced; no unbounded global cache is introduced.

## 6. Reuse diff alignment decisions

**Priority: Medium — avoid duplicated expensive computation.**

### Evidence

[diffEngine.ts](../src/client/diffEngine.ts) performs alignment for inline highlighting and again for split rows. Both use bounded similarity/LCS work in [lineAlignment.ts](../src/client/lineAlignment.ts).

### Safe implementation

1. Add characterization cases for repeated lines, newline markers, and cumulative budget exhaustion.
2. Introduce an internal change-block representation holding shared pairing decisions and highlights.
3. Preserve the public diff-engine interface and computation limits.
4. Compare old and new output using existing fixtures before removing the old implementation.
5. Benchmark paired-mode computation to confirm the change is worthwhile.

### Acceptance criteria

- Unified and split representations preserve existing output semantics.
- Alignment work is shared without accidentally widening computation budgets.
- Existing diff and alignment regression tests pass.

## 7. Measure scalability beyond row virtualization

**Priority: Medium — measurement-led performance work.**

### Evidence

[CommitList.tsx](../src/client/CommitList.tsx) computes graph layout for accumulated history. Lane allocation in [graph.ts](../src/client/graph.ts) scans occupied tracks and can grow poorly with disconnected histories. [DiffPatch.tsx](../src/client/DiffPatch.tsx) renders every diff row; history virtualization does not bound diff DOM size. These are potential bottlenecks, not measured production regressions.

### Safe implementation

1. Extend [measure-refactor.ts](../scripts/measure-refactor.ts) with disconnected and merge-heavy graphs and deep history pagination.
2. Measure large-patch DOM size, rendering latency, and interaction responsiveness in a browser.
3. Define representative fixture sizes and record runtime/environment with results.
4. Optimize graph occupancy allocation only if measurements justify it.
5. Introduce logical-row windowing first for unwrapped diffs; retain the wrapped split-grid path initially.
6. Test lane pinning, priority reordering, aligned gutters, context expansion, newline markers, keyboard scrolling, and mode changes.

### Acceptance criteria

- Optimizations demonstrate improvement on representative fixtures.
- Pagination preserves graph layout guarantees.
- Diff windowing does not break context expansion, selection, or scrolling.

## 8. Clarify snapshot and repository-result contracts

**Priority: Lower — reduce ambiguity before future caching and API changes.**

### Evidence

[git.ts](../src/repository/git.ts) freezes history reachability in snapshots but reloads current reference decorations for each page. [types.ts](../src/repository/types.ts) makes file counts optional even though the reader supplies them or throws. Source retrieval also resolves comparison context before file enumeration resolves it again.

### Safe implementation

1. Document frozen history reachability versus live reference labels in the types and user documentation.
2. Add a moved-tag decoration test during pagination.
3. Encapsulate snapshot lookup, refresh, and eviction without changing cursor identity or replay behavior.
4. Separate uncounted parser results from counted repository results.
5. Pass immutable comparison context to file enumeration instead of resolving it twice.
6. Add command-count assertions before introducing broader caching.

### Acceptance criteria

- Snapshot semantics are explicit without silently changing existing behavior.
- Cursor replay, exclusion freezing, and LRU eviction remain covered.
- Count, root, merge, rename, copy, and deletion behavior remains unchanged.

## Execution and validation strategy

Recommended order:

1. Fix items 1–2 independently.
2. Add browser coverage from item 3.
3. Refactor startup and service ownership in items 4–5.
4. Share diff computation and pursue measured scalability work in items 6–7.
5. Tighten contracts in item 8.

Creating commits is part of the implementation responsibility. Commit completed, validated work at logical milestones rather than leaving it uncommitted until the entire plan is finished. Prefer small commits, but prioritize self-contained changes: each commit should represent a coherent unit of work and leave the project in a working state. Separate mechanical extraction from behavioral/algorithmic changes where practical, include directly related tests and documentation, and do not bundle unrelated cleanup.

Add characterization or failing regression tests before changing behavior. Run the smallest relevant test set while iterating, then typecheck, the full test suite, build, and artifact smoke test before merging behavior-affecting work. Validate releases on the pinned CI runtime.

Do not combine algorithm changes with state-management restructuring, dependency upgrades, or formatting cleanup. Update directly related documentation when behavior or contracts change. Preserve existing public interfaces where practical and use incremental extraction rather than a big-bang rewrite.
