# Prioritized refactor plan

## Goal and scope

Improve maintainability and reliability without changing the read-only viewer's public behavior. Execute in small, independently reviewable commits rather than as a rewrite. Update these checkboxes and record validation results as implementation progresses.

This plan follows a source review of the client, repository reader, live-refresh flow, and HTTP/API layer. The review baseline passed `pnpm typecheck` and `pnpm test` (80 tests, 0 failures). Re-establish the baseline before implementation; it is not a guarantee for future changes.

Phase 0 adds safeguards and measurements only; production behavior is unchanged.

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

- [x] Run `pnpm typecheck` and `pnpm test`; record the baseline.
- [x] Extend [monitor tests](../tests/monitor.test.ts) with controlled slow-consumer/backpressure cases, cancellation with pending data, and shutdown with pending data.
- [x] Characterize mounted UI behavior: commit changes, file selection, layout/file-mode changes, live refresh, loading/error states, and retry.
- [x] Characterize keyboard focus and scrolling across commits, files, and diff, including virtualized/off-screen commit selection and empty commits.
- [x] Reuse current test tools where sufficient. Use the integrated browser for interaction checks. Add browser-testing dependencies only if repeatable mounted interaction coverage requires them, documenting the choice first.
- [x] Measure initial and subsequent history-request latency on controlled many-ref fixtures, and graph computation time at multiple history sizes. Keep fixture creation outside timed regions.

### Phase 0 characterization record

Baseline re-established on 2026-10-08: `pnpm typecheck` passed; `pnpm test` passed (87 tests, 0 failures). Existing Bun tests plus an integrated-browser checklist are sufficient for this phase; no dependencies or production code changes were required. Repeat this checklist before and after phases 2 and 3 rather than treating pure helper tests as mounted coverage.

The new controlled SSE tests use a consuming observer to acknowledge each metadata reconciliation, not sleeps. They demonstrate that a slow stream queues version 1, drops versions 2–9, and resumes at version 10 only after another change. This is an explicit characterization of the existing delivery defect, not desired behavior. Phase 1 must replace that expectation with its final-change delivery regression. Cancellation, abort, and repeated shutdown with queued/dropped events are covered; abort/shutdown currently drain the already queued event before EOF.

#### Reproducible mounted/browser checklist

Use an isolated temporary Git repository: root adds `alpha.txt` (400 numbered lines) and `nested/beta.txt`; `two files` modifies both (replace alpha with 400 `updated N` lines); branch `files` points to this commit; add 205 empty descendants on `main` via `commit-tree` with the unchanged tree. Disable fixture commit signing and set a local fixture identity. Start the viewer against the fixture, never mutate the source checkout. Choose available API/frontend ports without stopping existing services. Open the locally printed token URL in the integrated browser. With a non-default frontend port, Vite's proxy rewrites Host; same-origin GETs worked without changing the access guard.

| Check | Procedure and observed baseline |
| --- | --- |
| Empty commit | Select `empty 205`, press `l`: focus stays in commits; “No changed files” and the diff selection hint appear. |
| File selection and modes | Filter to `refs/heads/files`, select `two files`, select beta, switch list/tree and all three layouts: selected beta and diff path remain unchanged. |
| Commit-keyed reset | In tree mode select alpha, select root, wait for root details, then return to `two files`: selection resets to tree's first file, `nested/beta.txt`, not alpha. Wait for detail queries between steps. |
| Pane navigation | Focus the selected commit; `l` focuses selected file; `j`/`k` select adjacent files; `l` focuses Diff content; `h` returns to files and then commits. |
| Diff scrolling | Select alpha and wait for `+updated 400`; focus Diff content, press End/Home/PageDown: scrollTop was 15784/0/694 pixels respectively (viewport-dependent). |
| Parent navigation | From files, `n` selects root, reveals its commit row, and keeps focus in files. From diff, `n`/`p` navigate files, not commits. |
| Virtualized history | Clear reference filter, select first empty commit, move down 25 rows: `empty 180` is selected/revealed with only 23 mounted buttons. An additional paced `j` selects and focuses `empty 179`. |
| Modifier/control exclusions | Shift+j does not change selection. Focused reference select retains native keyboard handling. Layout buttons retain focus when activated. |
| Existing rapid-navigation limit | A rapid 25-key burst reached the selected off-screen commit but triggered “Too many concurrent Git operations; retry later” in details. Retry loaded `empty 180`. Do not silently change this baseline as part of extraction. |
| Live refresh retention | Filter to `files`, select `two files` and alpha; create an external empty commit on main: connection remains live and selected commit, alpha diff, and filter remain. Reload/clear filter: new `live addition` is visible. |
| Loading gates | Delay `**/api/trpc/**` by 800 ms using browser routing and reload: “Loading repository…” appears before repository data; references/history show their loading gates. Remove the route afterward. |
| Error/retry | Abort `**/api/trpc/**` in browser routing and reload: alert “Failed to fetch” with Retry. Remove route, press Retry: metadata, references and history recover. The rapid-navigation case also checks commit-detail retry. |

The checklist was run against the development viewer in Strict Mode. No permanent browser-testing dependency was added. Fixture directories and viewer processes are removed after checks.

#### Performance baseline

Run `pnpm exec bun scripts/measure-refactor.ts`. The [measurement script](../scripts/measure-refactor.ts) creates/removes its own temporary repository, fixes fixture identities/dates, and excludes repository discovery, fixture creation and graph input construction from timing. Seven samples per case; history uses 200-row pages, a 600-commit shared chain and distinct custom-ref tips. “Initial” uses a fresh reader (not cold OS caches), “repeated” repeats the first request on that reader, and “subsequent” follows its cursor. These are repository-reader request measurements, excluding HTTP transport/browser work. Graph measurements warm up once and include full layout and append from a half-sized previous layout; synthetic branching inputs include extra parents and feature decorations. Timing is observational, not a flaky test threshold.

Environment: Linux, Bun 1.4.0, Git 2.43.0. Median milliseconds:

| Custom refs / total commits | Initial history | Repeated first page | Subsequent page |
| --- | ---: | ---: | ---: |
| 32 / 632 | 80.125 | 78.469 | 17.712 |
| 160 / 760 | 367.630 | 342.898 | 24.304 |
| 512 / 1112 | 956.978 | 963.412 | 37.520 |

| Graph rows | Linear full / append | Branching full / append |
| --- | ---: | ---: |
| 200 | 0.538 / 0.432 | 0.559 / 0.554 |
| 1000 | 1.777 / 2.858 | 1.035 / 1.571 |
| 5000 | 7.899 / 6.645 | 7.245 / 7.806 |

The script prints min/median/max for rerun comparison. Shared-host scheduling, OS caches and GC affect results; compare on the same environment before phase 4 optimization.

**Exit condition:** the behavior touched by each phase is reproducible through automated tests or a recorded browser checklist; optimization work has a baseline measurement.

## Phase 1 — Reliable SSE invalidation delivery

**Location:** [HTTP handler](../src/server/http.ts), [repository monitor](../src/repository/monitor.ts), and [monitor tests](../tests/monitor.test.ts).

Phase 0 reproduced discarded invalidations when `desiredSize` was not positive. An earlier queued event does not necessarily cover a later repository change if its resulting refresh has already occurred. Phase 1 now retains the latest pending invalidation and delivers it on consumer demand.

- [x] Write a regression test where an earlier queued event is consumed, a later event arrives under backpressure, and no further repository changes occur.
- [x] Retain at most one pending latest invalidation when the stream cannot accept an event.
- [x] Flush pending invalidation on consumer demand through the stream's `pull` lifecycle. Do not create an unbounded queue.
- [x] Preserve the initial connected event and monotonic event versions; verify burst coalescing explicitly.
- [x] Make abort, cancellation, and shutdown idempotent and clear pending state/listeners.

Implementation: each stream keeps at most one queued event plus one latest pending invalidation. Both monitor delivery and `pull` use the same flush path. Cleanup discards pending state, disables flushing, unsubscribes and removes the abort listener; abort/shutdown still drain already queued data before EOF. No monitor changes were necessary.

Regression evidence: before the fix, the controlled test consumed version 1, queued version 2, produced versions 3–10 under backpressure, then timed out waiting for version 10 with no further changes. After the fix it receives versions 2 and 10, followed by 11 on a new change. A separate test leaves the connected event unread during eight changes and verifies connected version 0 followed only by changed version 8. Existing cancellation/abort/repeated-shutdown tests run with both queued and pending data, checking that pending data is not delivered after termination.

**Validation:** `pnpm test tests/monitor.test.ts tests/client-access.test.ts tests/live-client.test.ts` and `pnpm typecheck`.

**Acceptance:** a final repository change eventually reaches a consuming connected client even after backpressure, without requiring another change or reconnect; buffering stays bounded.

## Phase 2 — Separate rendering and orchestration

**Location:** [client entry point](../src/client/main.tsx).

- [x] Extract `CommitView` into its own component without changing props, queries, effects, or the selected-commit key.
- [x] Extract the history pane's rendering behind explicit props; leave state ownership unchanged initially.

Rendering milestone: extracted [CommitView](../src/client/CommitView.tsx), [HistoryPane](../src/client/HistoryPane.tsx), and [Failure](../src/client/Failure.tsx). The existing authenticated API singleton moved to [api](../src/client/api.ts) so detail queries use the same client without importing the entry point. App still owns selection/focus/filter state, commit-keyed lifecycle, queries, live setup and preferences. `pnpm typecheck` and 34 relevant client tests passed.
- [x] In a separate commit, introduce a repository-query hook preserving query keys, dependency gates, cancellation signals, and pagination options.
- [x] Extract live-connection setup/cleanup into a focused hook without changing refresh ordering in [live refresh](../src/client/live.ts).
- [x] Extract preference state/persistence into focused hooks, preserving the existing storage helpers and access guards. Do not introduce a generic settings framework.
- [x] Keep selection/focus state in a clear shared owner; do not introduce global state or context solely to shorten prop lists.

Hook milestone: [useRepositoryQueries](../src/client/useRepositoryQueries.ts) preserves query keys, signals, gates, cursor/revision handling, retry settings and history flattening/pagination. [useLiveConnection](../src/client/useLiveConnection.ts) uses the existing QueryClient provider and retains refresh/connection cleanup order, with explicit client/token dependencies. [useViewerPreferences](../src/client/useViewerPreferences.ts) retains each preference's initialization, persistence effect, storage helpers and blocked-storage guards. App continues to own selection/focus/filter and layout sizing; CommitView retains file state, immutable detail/diff queries and local DOM refs. Keyboard listeners are deliberately unchanged pending phase 3.

Integrated-browser rerun on the phase 0 fixture (Strict Mode, isolated ports): empty-commit focus gate; file retention across list/tree and all layouts; commit-keyed reset to beta; commits/files/diff focus transfer; file-parent `n` retention; End/Home/PageDown scrolling (15784/0/694 px); Shift+j exclusion; 25 paced moves to off-screen `empty 180` with 23 mounted buttons and correct DOM focus; pagination through root; tree/split/wrap persistence on reload; loading repository gate; injected metadata failure and successful Retry all passed. An external commit plus new `refresh-probe` branch appeared via live reference refresh while `two files`, alpha and the `files` filter remained selected. A delayed-routing run observed loading but timed out awaiting history; removing the browser route and reloading restored history, then explicit failure/retry checks passed. Browser routes and temporary viewer processes/fixture were cleaned up. No new dependencies were needed.

Added [history-pane tests](../tests/history-pane.test.tsx) for independent loading/error/retry/empty/pagination rendering, unavailable selected filters, exclusion of non-commit refs, and focus styling. Final validation: `pnpm typecheck`, 94 full-suite tests, `pnpm build`, and rebuilt-artifact `pnpm test:artifact` passed.

**Validation:** relevant client-helper tests, `pnpm typecheck`, and the mounted/browser checklist from phase 0.

**Acceptance:** the entry point mainly composes components and providers; extracted rendering and hooks retain existing behavior, including Strict Mode cleanup.

## Phase 3 — Centralize keyboard coordination

**Location:** extracted application/commit components and [navigation helpers](../src/client/navigation.ts).

- [x] Retain the existing pure action helpers rather than redesigning navigation semantics.
- [x] Introduce one coordinating hook owning the global keyboard listener.
- [x] Dispatch calculated actions through explicit pane adapters for selection, focus, reveal, and scrolling; keep pane DOM refs local where possible.
- [x] Preserve the distinction between moving selection and transferring focus, especially parent-pane `n`/`p` navigation.
- [x] Verify listener cleanup, current-state dependencies, and no duplicate handling under Strict Mode.

Implementation: [useKeyboardNavigation](../src/client/useKeyboardNavigation.ts) owns the single global listener and dispatches through explicit commit and detail adapters using the existing helpers. App supplies current commit selection and virtualized reveal operations. CommitView publishes its current file selection/focus/scroll adapter in a layout effect, clears it on cleanup, and retains its local DOM refs. The listener re-registers with current application state and reads the current detail adapter; no listener remains in CommitView. Parent `n`/`p` in files changes the commit without taking focus; in diff it changes the file without leaving diff, including scroll reset on path changes. Commit-keyed remounts and existing focus effects are preserved.

Added coordinator contract tests and listener setup/cleanup/re-registration tests covering single dispatch, current selection, missing/empty details, parent selection versus focus, modifier/composition/defaultPrevented exclusions. Targeted navigation/history tests: 15 passed. Full validation: 96 tests, `pnpm typecheck`, `pnpm build`, and rebuilt-artifact `pnpm test:artifact` passed.

Mounted Strict Mode browser checks on an isolated fixture passed: empty-commit `l` gate; 25 paced `j` presses selected and focused off-screen `empty 180` with 23 mounted buttons; files/tree and diff focus transfer; diff `p` selected beta while retaining diff focus; files `n` remounted root while focusing beta; root alpha End/Home/PageDown scrolled 7674/0/694 px; Shift+k exclusion; reference select retained its keyboard behavior; resizer ArrowRight changed 30 to 32 without pane navigation; list-mode navigation and commit-keyed remount returned correct focus/selection. The old hidden shared browser tab did not reliably deliver native clicks/keys or animation frames, so checks were repeated successfully in a newly opened tab. Temporary servers and fixture were cleaned up.

**Validation:** `pnpm test tests/navigation-client.test.ts tests/history-client.test.ts`, `pnpm typecheck`, and mounted/browser interaction checks.

**Acceptance:** one shortcut produces one action, including across remounts; controls retain their own keyboard handling and virtualized selections become visible/focused correctly.

## Phase 4 — Reduce history-request work

**Location:** [Git reader](../src/repository/git.ts).

- [x] Build a per-request map from commit ID to reference names instead of scanning every ref for every summary. Preserve reference order and result shapes.
- [x] Benchmark this isolated change before proceeding.

Reference-index milestone: history and commit details build an ordered, request-local commit-ID/name map; no persistent decoration cache. Targeted repository/API/history tests and typecheck passed. Seven-sample measurements on Bun 1.4.0 / Git 2.43.0, using the phase 0 measurement script, yielded initial/repeated/subsequent medians (ms): 32 custom refs baseline 91.083/90.811/18.649 → index 88.233/91.195/18.456; 160 refs 356.889/355.920/24.372 → 344.057/345.693/24.627; 512 refs 1094.649/1078.591/39.525 → 1054.342/1071.131/40.060. Custom refs are not displayed decorations, so these measurements principally confirm the remaining per-tip subprocess cost rather than establish an indexing speedup. No timing thresholds were added.
- [x] Investigate bulk tip resolution/peeling to reduce one-process-per-tip overhead. Adopt only an approach verified against current Git compatibility and fixtures.
- [x] Preserve filtering of non-commit targets, custom refs, detached HEAD, deduplication, tip limits, deterministic ordering, and snapshot pagination.
- [x] Do not add a long-lived ref/history cache, change history chunk size, or impose a new retention cap as part of this phase.

Bulk milestone: keep the captured `rev-parse --all` object IDs and peel each unique ID through one `cat-file --batch-check=%(objectname) %(objecttype)` process, using `^{}` to recursively peel tags without treating blob/tree targets as command failures. Keep only commit results; retain the existing pre-deduplication tip-limit check, separately resolve HEAD, then deduplicate/sort exactly as before. Revision-specific requests and snapshot cursor handling remain unchanged. The internal runner only gains optional buffered stdin for this command; execution flags, output caps, cancellation, concurrency and cleanup remain unchanged. No runner/parser extraction was included.

Git 2.43.0 probes verified nested annotated tags, annotated/lightweight non-commit targets, and unborn HEAD. Bulk `rev-parse --revs-only` stopped on a non-commit target, so it was rejected. Batch cat-file preserves one result per captured input. Integration tests compare history with the original individual-resolution algorithm across mixed custom/standard refs and detached HEAD; verify decoration order and commit-detail agreement, non-commit-only empty history, and pre-deduplication tip-limit behavior. A traced reader request asserts exactly five commands (`rev-parse`, `cat-file`, HEAD `rev-parse`, `for-each-ref`, `log`) regardless of tip count. Existing pagination, custom-tip membership, worktree/bare, snapshot eviction and cancellation fixtures pass.

Same seven-sample fixture medians after bulk peeling (initial/repeated/subsequent ms): 32 custom refs 27.426/26.504/18.131; 160 refs 39.849/38.863/23.135; 512 refs 74.962/75.009/39.416. Versus the indexed milestone, initial-page medians improve approximately 3.2×/8.6×/14.1×. First-page process count falls from one resolver per distinct captured object plus four fixed commands to five total; cursor pages still use the same two commands. Measurements exclude discovery/HTTP, are not cold filesystem cache measurements, and add no flaky timing threshold. Final validation: 99 tests, `pnpm typecheck`, `pnpm build`, and rebuilt-artifact `pnpm test:artifact` passed.

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
| 0 — Safeguards                    | Complete | Baseline: 87 tests; final: 91 tests, 0 failures; typecheck, build and rebuilt-artifact smoke passed. Integrated-browser checklist and reader/graph measurements recorded above. |
| 1 — SSE delivery                  | Complete | Regression failed before fix (SSE timeout), then passed; 16 targeted tests and 92 full-suite tests passed; typecheck, build and rebuilt-artifact smoke passed. |
| 2 — Component/hooks extraction    | Complete | Rendering and hooks in separate commits; 94 tests passed; typecheck, build, rebuilt-artifact smoke and mounted browser checks passed (see record above). |
| 3 — Keyboard coordination         | Complete | One global listener with explicit pane adapters; 96 tests, typecheck, build, artifact smoke and mounted Strict Mode browser checks passed. |
| 4 — History work reduction        | Complete | Separate reference-index/bulk-peeling milestones; initial history medians improve 3.2×–14.1×; 99 tests, typecheck, build and artifact smoke passed. |
| 5 — Git parsing/runner boundaries | Not started | —                                                       |
| 6 — Small shared utilities        | Not started | —                                                       |
