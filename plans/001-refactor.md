# Prioritized refactor plan

## Goal and scope

Improve maintainability and reliability without changing the read-only viewer's public behavior. Execute in small, independently reviewable commits rather than as a rewrite. Update these checkboxes and record validation results as implementation progresses.

This plan follows a source review of the client, repository reader, live-refresh flow, and HTTP/API layer. The review baseline passed `pnpm typecheck` and `pnpm test` (80 tests, 0 failures). Re-establish the baseline before implementation; it is not a guarantee for future changes.

No implementation changes are included in this plan.

## Priority and execution order

| Order | Priority    | Work                                                          | Prerequisite                                                       |
| ----- | ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Foundation  | Establish characterization tests and performance measurements | None                                                               |
| 1     | High        | Reliable SSE invalidation delivery under backpressure         | Relevant characterization tests                                    |
| 2     | High        | Separate application orchestration from rendering             | UI characterization tests                                          |
| 3     | Medium-high | Give keyboard navigation one coordinating owner               | Component extraction and navigation characterization tests         |
| 4     | Medium      | Reduce per-request history work                               | History characterization tests and measurements                    |
| 5     | Medium      | Separate Git parsing and subprocess execution                 | Repository characterization tests; coordinate with history changes |
| 6     | Low         | Consolidate duplicated validation and presentation utilities  | Relevant contract tests; preferably after module boundaries settle |

SSE reliability is a behavioral fix and must remain separate from mechanical refactoring. History optimization can proceed independently of UI work. Do not edit the same repository-reader code concurrently for phases 4 and 5.

## Behavior that must remain unchanged

- Read-only Git operations, local data processing, and existing access controls.
- Existing API shapes, repository interface, query keys, error codes, and loading gates.
- History filters, topological order, immutable tip snapshots, and cursor semantics.
- Custom refs, detached HEAD, empty and bare repositories, linked worktrees, and non-commit tags.
- First-parent merge comparisons, root comparisons, literal file paths, and binary/oversized diff behavior.
- Selected commit/file retention during live refresh, and immutable detail/diff caching.
- Commit changes reset file selection through the current commit-keyed component lifecycle.
- Keyboard focus, parent-pane navigation, pane scrolling, modifier exclusions, and controls' own key handling.
- Preference defaults, storage keys, blocked-storage fallback, and per-layout pane sizes.
- Cancellation, subprocess cleanup, output/concurrency limits, bounded SSE buffering, and shutdown behavior.
- Graph lane allocation and page-boundary behavior.

## Phase 0 — Establish safeguards

- [ ] Run `pnpm typecheck` and `pnpm test`; record the baseline.
- [ ] Extend [monitor tests](../tests/monitor.test.ts) with controlled slow-consumer/backpressure cases, cancellation with pending data, and shutdown with pending data.
- [ ] Characterize mounted UI behavior: commit changes, file selection, layout/file-mode changes, live refresh, loading/error states, and retry.
- [ ] Characterize keyboard focus and scrolling across commits, files, and diff, including virtualized/off-screen commit selection and empty commits.
- [ ] Reuse current test tools where sufficient. Use the integrated browser for interaction checks. Add browser-testing dependencies only if repeatable mounted interaction coverage requires them, documenting the choice first.
- [ ] Measure initial and subsequent history-request latency on controlled many-ref fixtures, and graph computation time at multiple history sizes. Keep fixture creation outside timed regions.

**Exit condition:** the behavior touched by each phase is reproducible through automated tests or a recorded browser checklist; optimization work has a baseline measurement.

## Phase 1 — Reliable SSE invalidation delivery

**Location:** [HTTP handler](../src/server/http.ts), [repository monitor](../src/repository/monitor.ts), and [monitor tests](../tests/monitor.test.ts).

The handler currently discards invalidations when `desiredSize` is not positive. An earlier queued event does not necessarily cover a later repository change if its resulting refresh has already occurred. This is a code-path concern from review, not a reproduced regression yet.

- [ ] Write a regression test where an earlier queued event is consumed, a later event arrives under backpressure, and no further repository changes occur.
- [ ] Retain at most one pending latest invalidation when the stream cannot accept an event.
- [ ] Flush pending invalidation on consumer demand through the stream's `pull` lifecycle. Do not create an unbounded queue.
- [ ] Preserve the initial connected event and monotonic event versions; verify burst coalescing explicitly.
- [ ] Make abort, cancellation, and shutdown idempotent and clear pending state/listeners.

**Validation:** `pnpm test tests/monitor.test.ts tests/client-access.test.ts tests/live-client.test.ts` and `pnpm typecheck`.

**Acceptance:** a final repository change eventually reaches a consuming connected client even after backpressure, without requiring another change or reconnect; buffering stays bounded.

## Phase 2 — Separate rendering and orchestration

**Location:** [client entry point](../src/client/main.tsx).

- [ ] Extract `CommitView` into its own component without changing props, queries, effects, or the selected-commit key.
- [ ] Extract the history pane's rendering behind explicit props; leave state ownership unchanged initially.
- [ ] In a separate commit, introduce a repository-query hook preserving query keys, dependency gates, cancellation signals, and pagination options.
- [ ] Extract live-connection setup/cleanup into a focused hook without changing refresh ordering in [live refresh](../src/client/live.ts).
- [ ] Extract preference state/persistence into focused hooks, preserving the existing storage helpers and access guards. Do not introduce a generic settings framework.
- [ ] Keep selection/focus state in a clear shared owner; do not introduce global state or context solely to shorten prop lists.

**Validation:** relevant client-helper tests, `pnpm typecheck`, and the mounted/browser checklist from phase 0.

**Acceptance:** the entry point mainly composes components and providers; extracted rendering and hooks retain existing behavior, including Strict Mode cleanup.

## Phase 3 — Centralize keyboard coordination

**Location:** extracted application/commit components and [navigation helpers](../src/client/navigation.ts).

- [ ] Retain the existing pure action helpers rather than redesigning navigation semantics.
- [ ] Introduce one coordinating hook owning the global keyboard listener.
- [ ] Dispatch calculated actions through explicit pane adapters for selection, focus, reveal, and scrolling; keep pane DOM refs local where possible.
- [ ] Preserve the distinction between moving selection and transferring focus, especially parent-pane `n`/`p` navigation.
- [ ] Verify listener cleanup, current-state dependencies, and no duplicate handling under Strict Mode.

**Validation:** `pnpm test tests/navigation-client.test.ts tests/history-client.test.ts`, `pnpm typecheck`, and mounted/browser interaction checks.

**Acceptance:** one shortcut produces one action, including across remounts; controls retain their own keyboard handling and virtualized selections become visible/focused correctly.

## Phase 4 — Reduce history-request work

**Location:** [Git reader](../src/repository/git.ts).

- [ ] Build a per-request map from commit ID to reference names instead of scanning every ref for every summary. Preserve reference order and result shapes.
- [ ] Benchmark this isolated change before proceeding.
- [ ] Investigate bulk tip resolution/peeling to reduce one-process-per-tip overhead. Adopt only an approach verified against current Git compatibility and fixtures.
- [ ] Preserve filtering of non-commit targets, custom refs, detached HEAD, deduplication, tip limits, deterministic ordering, and snapshot pagination.
- [ ] Do not add a long-lived ref/history cache, change history chunk size, or impose a new retention cap as part of this phase.

**Validation:** `pnpm test tests/repository.test.ts tests/viewer-api.test.ts tests/history-client.test.ts`, `pnpm typecheck`, and comparable before/after measurements.

**Acceptance:** output remains equivalent, reference attachment becomes a per-request indexed operation, and any tip-resolution change demonstrably reduces process overhead without altering history membership.

## Phase 5 — Separate Git parsing and execution

**Location:** [Git reader](../src/repository/git.ts) and [repository tests](../tests/repository.test.ts).

- [ ] Extract pure parsers for references, summaries, details, and changed files first.
- [ ] Add parser fixtures for NUL-delimited records, empty output, unusual literal paths, supported statuses, and malformed/truncated records with explicit error behavior.
- [ ] Keep parser extraction separate from changes to command construction or limits.
- [ ] Extract subprocess execution behind a narrow internal runner boundary only after parser behavior is stable.
- [ ] Preserve argument arrays, Git configuration flags, environment filtering, output caps, concurrency accounting, abort handling, and exit/error normalization.
- [ ] Test runner cleanup on success, failure, cancellation, and output-limit termination using a controlled internal seam where needed.
- [ ] Avoid re-resolving or changing comparison bases as an incidental cleanup.

**Validation:** targeted new parser/runner tests, `pnpm test tests/repository.test.ts tests/viewer-api.test.ts`, and `pnpm typecheck`.

**Acceptance:** parsers are testable without spawning Git, repository integration contracts still pass, and the runner retains existing lifecycle guarantees.

## Phase 6 — Consolidate small duplications

**Location:** [router validation](../src/server/router.ts), [reader validation](../src/repository/git.ts), [date formatting](../src/client/CommitList.tsx), and extracted client components.

- [ ] Share pure revision/path validation predicates, without importing server schemas into the client or coupling the reader to tRPC.
- [ ] Preserve layer-specific error messages/codes and document intentional differences, including the API's path-length limit.
- [ ] Add table-driven cases covering direct-reader and API validation before consolidation.
- [ ] Reuse a client date formatter preserving locale, options, and invalid-date fallback.
- [ ] Remove redundant preference guards only if blocked `window.localStorage` property access remains protected.

**Validation:** related repository/API/client tests and `pnpm typecheck`.

**Acceptance:** duplication is reduced without silently broadening or narrowing accepted inputs or changing displayed dates/preferences.

## Merge and rollback procedure

1. Start each phase from a clean, understood checkout; preserve unrelated changes.
2. Add characterization/regression tests first. For a behavioral fix, establish that the new test fails for the intended reason.
3. Creating commits is part of the implementation responsibility. Commit completed, validated work at logical milestones rather than leaving it uncommitted until the entire plan is finished. Prefer small commits, but prioritize self-contained changes: each commit should represent a coherent unit of work and leave the project in a working state. Separate mechanical extraction from behavioral/algorithmic changes where practical, include directly related tests and documentation, and do not bundle unrelated cleanup.
4. Run the smallest relevant test selection and typecheck after each implementation step. Investigate failures before proceeding.
5. Before merging, run `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm test:artifact`. Confirm the smoke script exercises the newly built artifact.
6. Verify the built viewer: all layouts, resize, preferences, reference switching, pagination, file/diff modes, keyboard focus, live updates, reconnect, and error/retry states.
7. Update [README](../README.md) only for changed behavior or developer workflow; keep existing contracts documented accurately.
8. Revert an individual phase/commit if regressions cannot be resolved; avoid leaving partially migrated state owners or duplicate listeners.

Use pnpm for project scripts and package management. Install dependencies only after a justified manifest change or a missing-dependency validation failure.

## Deferred work

- Graph algorithm rewrite or lane-allocation changes: retain [existing graph contracts](../tests/graph-client.test.ts); profile before considering optimization.
- New global state libraries, generic event buses, generic utility frameworks, or additional API layers.
- Long-lived repository caches, pagination redesign, history-retention changes, and distribution/runtime changes.

## Implementation record

| Phase                             | Status      | Validation and measurement results                      |
| --------------------------------- | ----------- | ------------------------------------------------------- |
| 0 — Safeguards                    | Not started | Review baseline only: typecheck passed; 80 tests passed |
| 1 — SSE delivery                  | Not started | —                                                       |
| 2 — Component/hooks extraction    | Not started | —                                                       |
| 3 — Keyboard coordination         | Not started | —                                                       |
| 4 — History work reduction        | Not started | —                                                       |
| 5 — Git parsing/runner boundaries | Not started | —                                                       |
| 6 — Small shared utilities        | Not started | —                                                       |
