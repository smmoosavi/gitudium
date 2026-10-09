# Diff view improvement plan

## Goal and scope

Make changes easier to understand without cluttering the read-only viewer. Implement one step at a time, validate it, and review the result before moving to the next step. This document tracks the suggested improvements and completed implementation steps.

The current viewer supports unified and split modes, persisted line wrapping, and line numbers in split mode. It also handles binary and oversized patches explicitly.

## Working approach

- Start each step by confirming its scope and any significant design choices.
- Keep changes independently reviewable; avoid a full diff-view rewrite.
- Reuse existing tooling and use pnpm for package commands.
- Add focused regression tests and run the smallest relevant validation commands.
- Check visual and keyboard behavior in the integrated browser for UI changes.
- Update the checkboxes and record validation results after each completed step.
- Keep new dependencies optional until an implementation decision requires them. Process repository content locally.

## Behavior to preserve

- Unified/split preference and wrapping preference, including storage failure fallbacks.
- Added/deleted files currently render in unified mode.
- Correct old/new line numbers, hunk boundaries, and missing-final-newline indicators.
- First-parent merge comparisons and root-commit comparisons.
- File selection, pane focus, keyboard navigation, and scrolling across layouts.
- Loading, error, retry, binary, oversized, and no-textual-change states.
- Read-only repository operations and existing resource limits.
- Render source text safely; never treat repository content as HTML.

## Suggested execution order

### Step 1 — Word-level highlighting

- [x] Highlight changed words or character spans within paired removed/added lines.
- [x] Use stronger inline highlights over subtle whole-line change backgrounds.
- [x] Support unified and split modes; retain whole-line highlighting for unmatched lines.
- [x] Bound matching work for long lines and large change blocks, falling back to whole-line highlighting.
- [x] Test insertions, deletions, replacements, Unicode, whitespace, and missing final newlines.

**Outcome:** Small edits to long lines become immediately visible.

### Step 2 — Syntax highlighting

**Decision:** Use Shiki (TextMate grammars) in a reusable Web Worker. Implement step 5's bounded before/after source retrieval before this step so tokenization can begin at the start of each file, preserving multiline string/comment state. Fetching only nearby context cannot guarantee that state. The expandable-context UI itself is not a prerequisite for highlighting.

- [ ] Load Shiki and tokenize only in the worker, with lazy loading of selected languages and a theme; measure worker bundle size, initialization cost, and result-application cost.
- [x] Render the existing diff immediately without syntax colors. Source loading and highlighting must not block the initial display or navigation.
- [x] Start the first or isolated highlighting request immediately. Requests arriving within 100 ms of the previous request switch to a trailing 100 ms debounce keyed to source identity, restarting it on each rapid request.
- [x] Reuse the worker and keep only the newest pending job rather than queueing every intermediate page during rapid navigation. Use request identities to discard stale results, including source-fetch responses; define worker cancellation/restart and timeout behavior for expensive active jobs.
- [x] Tokenize complete before/after source separately, using the exact comparison revisions and old/new paths from step 5, then map tokens to diff rows by source line numbers. Do not concatenate disjoint hunks or tokenize diff markers as source.
- [x] Return serializable token data, not HTML. Keep Shiki-specific logic behind a replaceable syntax-highlighting adapter and extend the stable render model only with library-independent styling data.
- [x] Combine syntax token boundaries with existing word-change spans so language colors and inline/whole-line change backgrounds coexist without changing source text.
- [x] Cache bounded results by immutable source identity, language, and theme; bound source size, token counts, worker execution, and rendered token volume. Keep repository content and language assets local rather than sending source to third-party services.
- [x] Use plain-text fallback for unknown languages, unavailable/oversized source, worker failures, or timeouts. If patch-only highlighting is offered, explicitly treat it as best-effort rather than multiline-correct.
- [x] Apply ready results without changing row order, line numbers, focus, text selection, or scroll position; verify contrast, wrapping, safe rendering, and both diff modes.
- [x] Test multiline constructs spanning omitted context, source-to-row mapping, rapid selection changes, debounce behavior, stale-result rejection, latest-job scheduling, cache bounds, and failure fallbacks.

**Outcome:** Diffs read like code rather than uniformly tinted text, while navigation and initial rendering remain responsive.

### Step 3 — Unified line numbers and cleaner headers

- [x] Add old/new line-number gutters to unified mode.
- [x] Match the file-diff and Changed files headers' single-row height to other panel headers: 30 px controls, 5 px vertical padding, and a 1 px border (41 px total); allow wrapping when space is limited.
- [x] Separate patch metadata from code rows instead of styling file headers as additions/deletions. Raw metadata is hidden in both modes; rename/copy paths and changed file modes remain compact title details.
- [x] Hide raw `@@` hunk headers in both modes; use line-number gutters for locations (unified gutters are next).
- [x] Keep gutters aligned with wrapped lines and support accurate missing-final-newline indicators in both modes. Fixed grid columns keep continuation lines inside the code column; unified newline markers have blank gutters.
- [x] Test multiple hunks, empty ranges, added/deleted files, and metadata-only changes. Targeted renderer/context/syntax suite: 32 tests passed; typecheck passed.

**Outcome:** Both modes provide clear locations and consistent presentation.

### Step 4 — Change-block navigation

- [ ] Add previous/next change controls and a position indicator such as “Change 2 of 8.”
- [ ] Define a change block as a contiguous group of changed rows, not necessarily an entire hunk.
- [ ] Select shortcuts that do not conflict with existing pane/file navigation.
- [ ] Keep the active block visible without unexpectedly moving keyboard focus.
- [ ] Reset navigation appropriately when the commit or file changes.

**Outcome:** Long diffs become navigable without repeated manual scrolling.

### Step 5 — Expandable context

- [x] Add “Show more above/below” controls between hunks and an optional full-file view. Infer leading/inter-hunk gaps from the patch immediately to prevent loading shifts; trailing gaps require source length. Keep Full file visible during loading and queue early expansion/full-file requests against the existing source query.
- [x] Provide complete before/after text retrieval for files within explicit size limits; the existing patch alone cannot supply omitted context. Reuse this source data for step 2's multiline-correct highlighting, independent of which context rows are currently expanded.
- [x] Resolve exact comparison revisions and old/new paths, including renames, first-parent merges, root commits, and absent sides of added/deleted files.
- [x] Design bounded, cancellable source retrieval and caching while preserving binary and size safeguards. Do not load arbitrarily large files into memory or delay the initial patch display.
- [x] Test beginning/end of file, overlapping expansions, added/deleted files, and root commits.

**Outcome:** Changes can be understood in their surrounding code.

### Step 6 — Whitespace controls

- [ ] Add an ignore-whitespace option with a clearly defined comparison policy.
- [ ] Optionally reveal tabs, spaces, and trailing whitespace without altering copied source text.
- [ ] Make it clear when a comparison filter hides changes.
- [ ] Test whitespace-only edits, indentation changes, wrapping, and preference behavior.

**Outcome:** Formatting noise can be separated from meaningful changes.

### Step 7 — Better split alignment and scrolling

- [ ] Match related removed/added lines rather than pairing solely by position.
- [ ] Reuse the bounded matching logic from word-level highlighting where appropriate.
- [ ] Offer synchronized horizontal scrolling while retaining independent scrolling when desired.
- [ ] Preserve aligned row heights when wrapping and verify uneven replacement blocks.

**Outcome:** Side-by-side comparisons stay visually related and easier to follow.

### Step 8 — File summary, search, and clean copying

- [ ] Show per-file addition/deletion counts, status, and old → new paths for renames.
- [ ] Add search within the displayed diff, with highlighted matches and next/previous navigation.
- [ ] Define whether search includes metadata, hidden context, and whitespace-filtered content.
- [ ] Provide clean copying without gutters or diff markers, including explicit “Copy before/after” actions.
- [ ] Distinguish copying displayed hunk content from copying a complete source file.
- [ ] Verify clipboard failures and keyboard accessibility.

**Outcome:** Common review tasks can be completed without leaving the viewer.

## Later enhancements

- [ ] Local image previews for supported binary formats, with size limits and safe format handling.
- [ ] Virtualized rendering if large-diff measurements justify it; retain size safeguards and account for search, selection, and wrapped row heights.
- [ ] A change overview strip for navigating long files, with accessible alternatives.

## First-release target

Steps 1–4 remain the first-release feature target: word-level highlighting, syntax highlighting, unified line numbers and cleaner headers, and change-block navigation. Revised execution order: step 1 → step 5 → step 2 → step 3 → step 4. Step 5's bounded complete-source retrieval is a prerequisite for accurate highlighting; its expandable-context UI can be reviewed independently. Steps 6–8 and later enhancements are not prerequisites for the first release. Review each step separately before proceeding.

## Progress and validation

### Step 1 — Completed on 2026-10-09

Implemented local, Unicode-aware word token matching with length-weighted common subsequences. Replacement lines retain the existing positional pairing; improved line alignment remains step 7. Both modes share patch-indexed highlight segments, preserve source text and missing-newline markers, and leave unmatched lines with whole-line highlighting. No dependencies added.

Matching falls back for lines over 4,096 UTF-16 code units, lines over 512 tokens, pairs over 65,536 matrix cells, replacement blocks over 100 lines per side, or an exhausted 1,000,000-cell budget per patch.

Validation:

- `pnpm test tests/diff-client.test.ts`: 11 tests passed, including text preservation, Unicode, whitespace, insertions/deletions, multiple hunks, missing newlines, escaping, wrapping, and resource-limit fallbacks.
- `pnpm typecheck`: passed; editor diagnostics reported no errors in changed TypeScript files.
- Integrated browser: rendered the actual component with application CSS in both modes, wrapping on/off; verified inline display, distinct addition/deletion highlight backgrounds, and preserved split-pane keyboard focus. This was an isolated component preview, not a full application navigation check.
- `git diff --check`: passed.

Follow-up: inline highlighting now requires at least 25% shared meaningful content relative to the longer line's letter/number/mark/underscore count. Shared whitespace and punctuation do not contribute. Unrelated replacements (including the reported constant-to-import example) fall back to whole-line coloring, while related import-list edits retain word highlights. Focused coverage now includes these similarity fallbacks.

Engine boundary: [diffModel.ts](../src/client/diffModel.ts) defines the stable `DiffEngine` contract (`patch → DiffModel`) and renderer-facing types. Engines return unified lines and split rows with optional highlight segments; segments must concatenate to their line text, and missing segments indicate whole-line fallback. [diffEngine.ts](../src/client/diffEngine.ts) is the default implementation adapter, combining split parsing and word matching. [DiffPatch.tsx](../src/client/DiffPatch.tsx) consumes only the model and performs no patch parsing or matching. Replace the default adapter, or inject an engine through the optional component prop, without changing rendering. Validation: 14 focused tests and typecheck passed, including a fake engine with opaque input proving both render modes use only supplied model data.

### Step 5 — Completed on 2026-10-09

Added a cancellable `sources` API with complete immutable before/after text, revision and path metadata, and nullable absent sides. Source retrieval resolves first-parent comparisons, root commits, renames and copies; accepts only changed literal paths; bypasses external Git helpers; and returns explicit binary, oversized or unavailable states. Each side is bounded to 1 MiB.

The patch renders independently and immediately. Complete source requests begin after a 100 ms stable selection, use request cancellation, and discard inactive query data (`gcTime: 0`) rather than accumulating full files. Source errors retain the patch and offer retry.

[diffContext.ts](../src/client/diffContext.ts) adds source-derived gaps and context rows to the replaceable engine's model without moving parsing into the renderer. Both modes reveal context in 20-line batches from either end, merge overlapping expansions, and offer Full file/Hunks only. Context state resets on commit/file changes. Full-file mode is restricted to 20,000 lines per side; expansion has a cumulative 20,000 additional-context-line budget. Metadata-only changes can reveal their source, and missing-final-newline markers are preserved.

Validation:

- Combined renderer, context, repository, input-validation and API suites: 46 tests passed, including source bounds/cancellation, rename/copy/root/merge comparisons, literal paths, insertion/deletion anchors, overlapping expansions, HTML escaping and rendering limits.
- `pnpm typecheck`, editor diagnostics and `git diff --check`: passed.
- Isolated full-application browser fixture: verified a middle-gap expansion from 53 to 33 hidden lines, full 100-line source display, split/wrapped row alignment, Hunks only restoration, and root-commit navigation resetting full-view state while preserving added-file unified rendering.

UI refinement: context controls use compact gutter icons with accessible labels/tooltips. Gaps of 20 lines or fewer show one expand-all button; larger gaps show two directional buttons. Both split sides use the same 40 px gap-row height and full-width background with no trailing padding. Validation: 22 focused tests and typecheck passed; browser measurements verified equal heights, aligned rows and zero unused right-side space in wrapped and unwrapped split layouts.

Toolbar follow-up: the Full file/Hunks only control uses a fixed 30 px height matching adjacent controls and reserves its width while source is loading or unavailable. Hidden controls are excluded from keyboard focus and accessibility exposure, avoiding toolbar reflow as source data arrives. Diff/context loading text and the added/deleted forced-unified notice are omitted to avoid transient layout shifts; errors and size/unavailable safeguards remain visible, and added/deleted files still render unified. Focused renderer tests and typecheck passed.

### Step 2 — Implemented on 2026-10-09

Shiki runs only in a reusable ES-module worker, with locally bundled lazy grammars and the GitHub dark theme. Complete before/after files are tokenized independently; library-independent text/color tokens map to old/new source coordinates, including expanded context. Token boundaries combine with word-change boundaries without changing text, line order or layout.

Highlighting starts immediately for the first request or after at least 100 ms without another request. Requests arriving within that window use a trailing 100 ms source-identity debounce; rapid requests restart the timer. Only the newest pending request is retained, stale results are discarded, and a 5-second timeout or worker failure terminates the worker so later requests can recover. The bounded immutable-source LRU retains at most four results and 200,000 tokens total. Source is capped at 1 MiB per side, results at 100,000 tokens and rendered styling at 50,000 segments; unknown languages and failures retain plain text. No source is sent to external services.

Validation:

- 39 focused tests passed, including debounce, newest-pending scheduling, stale responses, timeout/error recovery, cache/resource bounds, actual Shiki tokenization, source coordinates and word/syntax composition.
- Typecheck, production client build and `git diff --check`: passed. Vite worker output uses ES format to support lazy imports.
- Worker entry: 133.37 kB (43.22 kB gzip); all lazy language/theme assets total approximately 9.12 MB, not loaded eagerly. Main client entry: 347.83 kB (109.29 kB gzip).
- Browser fixture verified deferred syntax application, correct comment coloring when the hunk starts inside a comment opened in omitted context, and colored word-change marks in split mode. Both modes have rendering tests. Further browser interaction was unavailable after the shared client disconnected.
- Small-model token application averaged 0.008 ms over 10,000 iterations in Bun; this is not an end-to-end browser paint benchmark. Worker startup and large-result browser timings remain to be measured.
