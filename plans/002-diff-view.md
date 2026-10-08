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

- [ ] Choose a local highlighting approach after checking bundle size, supported languages, and integration with inline change spans.
- [ ] Preserve language colors while using backgrounds to indicate additions and deletions.
- [ ] Use plain-text fallback for unknown languages or highlighting failures.
- [ ] Ensure multiline language constructs are handled correctly; document any patch-only limitations.
- [ ] Verify contrast, wrapping, text selection, and safe rendering.

**Outcome:** Diffs read like code rather than uniformly tinted text.

### Step 3 — Unified line numbers and cleaner headers

- [ ] Add old/new line-number gutters to unified mode.
- [ ] Separate patch metadata from code rows instead of styling file headers as additions/deletions.
- [ ] Show compact hunk location labels and function names when supplied by Git.
- [ ] Keep gutters aligned with wrapped lines and support accurate missing-final-newline indicators in both modes.
- [ ] Test multiple hunks, empty ranges, added/deleted files, and metadata-only changes.

**Outcome:** Both modes provide clear locations and consistent presentation.

### Step 4 — Change-block navigation

- [ ] Add previous/next change controls and a position indicator such as “Change 2 of 8.”
- [ ] Define a change block as a contiguous group of changed rows, not necessarily an entire hunk.
- [ ] Select shortcuts that do not conflict with existing pane/file navigation.
- [ ] Keep the active block visible without unexpectedly moving keyboard focus.
- [ ] Reset navigation appropriately when the commit or file changes.

**Outcome:** Long diffs become navigable without repeated manual scrolling.

### Step 5 — Expandable context

- [ ] Add “Show more above/below” controls between hunks and an optional full-file view.
- [ ] Fetch surrounding before/after source; the existing patch alone cannot supply omitted context.
- [ ] Design bounded, cancellable source retrieval while preserving binary and size safeguards.
- [ ] Test beginning/end of file, overlapping expansions, added/deleted files, and root commits.

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

Steps 1–4: word-level highlighting, syntax highlighting, unified line numbers and cleaner headers, and change-block navigation. Review each step separately before proceeding. Later steps are suggestions, not prerequisites for the first release.

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

Step 2 has not started.
