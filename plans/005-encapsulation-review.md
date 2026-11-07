# Encapsulation and single-responsibility review

Status: Implementation in progress on `refactor/encapsulation-maintenance`.

Review baseline: clean `main`, HEAD `d143409ecfddf48da17ff7fe0b9e0214fced7dee`.
Implementations, callers, and relevant unit/browser tests were inspected. Tests were not executed during the read-only review. Source line references below describe this baseline.

## Architecture and assessment

The main dependency flow is React orchestration → query/transport → repository contract → Git readers, runner, and parsers. Diff rendering consumes a plain model; graph construction separates tracks, routing, geometry, and viewport behavior.

The architecture is generally well separated. Three high-confidence, medium-priority problems merit focused changes. File length, central orchestration, and shared domain utilities are not themselves reasons to refactor. No broad rewrite or plugin framework is proposed.

## High-confidence findings

### 1. P2: Syntax-specific matching leaks into the common diff pipeline

Evidence:

- `src/client/diffEngine.ts:14`: scope-aware patch rewriting.
- `src/client/diffEngine.ts:45`: common engine constructs textual and syntax matchers, maps syntax tokens, chooses fallbacks, and builds render representations.
- `src/client/wordDiff.ts:69`: block scanning accepts a separate syntax-specific callback bundle while constructing the textual highlighter internally.
- `src/client/syntaxMatcher.ts:16`: matching interprets slash-separated tokenizer types and literal JSON token names.

The external `DiffEngine` boundary is sound, but its implementations are intertwined. Replacing syntax matching or changing tokenizer role encoding requires changes in common engine assembly and potentially generic matching code. Adding another alignment policy naturally leads to another branch alongside `pairLines` and `syntax`.

Callers: `useSyntaxMatcher` constructs the syntax engine; `CommitView` selects engines; `DiffPatch` consumes their shared model. Engine and matcher tests exercise JSON scope repair and shared highlights.

Smallest behavior-preserving refactor:

- Retain `DiffEngine` and `DiffModel`.
- Move syntax token mapping, scope repair, and fallback composition into a syntax-engine module.
- Give block scanning one policy callback shape usable by positional, similarity, and syntax implementations.
- Normalize tokenizer-specific role information before generic matching consumes it.
- Keep worker IO, scheduling, and caching outside algorithm internals.

Regression checks: preserve serialized simple/paired output, source text and coordinates, newline markers, shared split/unified highlights, independent work budgets, stale-token fallback, JSON object-scope repair, and reversible UI switching. Start with `tests/diff-engine.test.ts`, `tests/syntax-matcher.test.ts`, and `browser/syntax-match.browser.ts`.

### 2. P2: History selection policy is interpreted separately for roots and decorations

Evidence:

- `src/repository/git.ts:125`: `historyTips` interprets terms, exclusions, shorthand references, wildcard matching, and positive/negative selections.
- `src/repository/git.ts:194`: `history` reparses exclusions and positive terms and independently implements wildcard/shorthand matching to filter decorations.

A new reference alias or changed wildcard rule must update both interpretations. Otherwise roots could include a reference whose decoration is hidden, or vice versa. Decorations also feed structural ordering priorities, so drift can affect ordering as well as labels. This is duplicated policy, not a claim that current outputs are incorrect.

Callers: API history requests and client pagination use `GitRepositoryReader.history`; saved snapshots freeze the resulting IDs and decorations.

Smallest behavior-preserving refactor: parse a history selection once into explicit terms and normalized exclusions. Share reference matching and explicit-override decisions between root resolution and decoration filtering. Retain the intentional differences between those operations. Keep Git resolution, snapshot storage, and pagination outside that policy.

Regression checks: preserve full/shorthand/custom refs, nested wildcard paths, negative-only expressions, explicit overrides of saved exclusions, detached HEAD, non-commit refs, and frozen pagination after refs move. Existing selection cases in `tests/repository.test.ts` start at lines 201, 234, and 681. Retain API validation coverage in `tests/input-validation.test.ts`.

### 3. P2: Committed and local readers independently own common Git diff-option behavior

Evidence:

- `src/repository/git.ts:300`: algorithm validation, whitespace-to-flag mapping, binary classification, and output-limit translation.
- `src/repository/local.ts:145`: repeats those responsibilities around local comparison handling.
- `src/server/router.ts:36`: local and committed endpoints separately enumerate the same option values.

Adding or correcting a whitespace policy requires coordinated changes in both readers and endpoint schemas. A validation difference already exists: the local reader rejects unknown whitespace values, while the committed reader falls through to no whitespace flags. API validation masks this difference for HTTP callers; direct reader behavior differs.

Callers: `CommitView` exposes one set of options for both comparison types; both readers implement `RepositoryReader`.

Smallest refactor: centralize option values, validation, and Git flag construction. Share patch-result classification where useful. Leave commit comparison selection, index/worktree handling, rename handling, and synthetic untracked patches in their respective readers. Preserve valid-input behavior; explicitly decide and test invalid direct-reader behavior rather than changing it silently during extraction.

Regression checks: exercise the algorithm/whitespace matrix through direct readers and API endpoints, including invalid values. Preserve root and rename comparisons, local scopes, conflict behavior, binary/oversized results, and untracked newline handling. Use `tests/repository.test.ts`, `tests/input-validation.test.ts`, and `tests/local-changes.test.ts`.

## Lower-confidence candidates

### P3: Detail query lifecycle is embedded in pane interaction

`src/client/CommitView.tsx:41` owns endpoint choice, comparison identity, cache retention, placeholder behavior, source-fetch debounce, context state, and later DOM navigation. Changing local refresh/cache behavior requires editing the component that implements focus and scrolling.

A comparison-query hook returning files, diff, sources, and status could isolate query lifecycle. However, the component legitimately coordinates these features; its size alone does not justify splitting it. Investigate whether this extraction actually reduces dependencies before proceeding.

Preserve scope selection, placeholder filtering, delayed responses, context resets, and focus behavior. Relevant checks include `tests/diff-query.test.ts`, `browser/local-changes.browser.ts`, `browser/app.browser.ts`, and `browser/syntax.browser.ts`.

### P3: Query-key structure leaks into placeholder policy

`src/client/diffQuery.ts:1` assumes comparison and path occupy positions 1 and 2 in keys built by `CommitView`. Namespacing those keys could silently disable placeholder retention.

A shared key factory/parser is sufficient if query work proceeds. This is too small to prioritize independently. Retain tests that prevent placeholder content crossing file or comparison boundaries.

## Sound boundaries to preserve

- History ordering's readonly context/result contract and independent structural/recent implementations.
- Graph track → route → drawing pipeline. Shared branch priority is currently coherent domain policy; no compelling need to duplicate or generalize it was found.
- `DiffModel`/`DiffEngine`, with context expansion and syntax coloring applied separately from rendering.
- `SyntaxService` ownership of highlighting worker scheduling, caching, timeout, and disposal.
- `GitRunner` process lifecycle and limits, pure Git parsers, and shared input-validation predicates.
- Server factory versus CLI process ownership, access protection before routing, and monitor events separated from SSE delivery.
- App-level selection, preferences, and navigation wiring: central coordination here is justified.

## Incremental sequence and risks

1. **Consolidate diff options.** Small scope, no dependency on other steps, and the clearest existing behavioral inconsistency. Decide invalid direct-reader behavior explicitly. Avoid conflating shared flags with comparison-specific command construction.
2. **Extract history selection policy.** Independent of step 1. Preserve current semantics first, especially exclusions, explicit overrides, decorations, and snapshot identity. Do not redesign pagination or ordering algorithms.
3. **Isolate syntax-engine composition.** Independent of steps 1–2; highest behavioral risk. First preserve existing outputs and work budgets, then move syntax-specific behavior behind the existing engine contract. Keep mechanical extraction separate from algorithm changes.
4. **Reassess detail-query extraction.** Optional. Combine with shared query-key ownership only if it materially simplifies lifecycle changes. Preserve keyed component resets, app-owned syntax-service lifetime, and DOM focus behavior.

Each step should be independently reviewable. Use pnpm for appropriate targeted checks during future implementation. Expand verification only where changed behavior or failures justify it; browser/build checks can create artifacts and were not run as part of this review.

## Implementation plan and decisions

1. Consolidate diff options, then validate and review before committing.
2. Extract history selection policy without changing roots, decorations, or snapshots.
3. Isolate syntax-engine composition if the existing contract permits a small extraction.
4. Reassess query lifecycle/key ownership; defer unless it reduces dependencies.

### Diff options

- Completed: canonical algorithm/whitespace values derive the public types and API schemas; both readers use a pure validator/flag builder before comparison IO.
- Intentional behavior change: committed direct-reader calls now reject unknown whitespace values with `INVALID_INPUT`, matching local calls. Invalid algorithms remain rejected. Valid inputs and defaults are unchanged; invalid-option error messages are now specific in both readers.
- Kept comparison commands, rename handling, local scopes, untracked patch construction, and runner limits in their existing owners. Deferred shared patch-result/error classification: the two short branches do not justify another execution abstraction.
- Regression coverage: all 16 algorithm/whitespace combinations compared with Git through committed/local readers and API; invalid runtime values rejected by both readers and endpoints. Existing root/rename, local conflict/scope, binary/oversized, and newline tests retained.
- Validation: `pnpm test --timeout 30000 tests/repository.test.ts tests/local-changes.test.ts tests/input-validation.test.ts` passed (39 tests); `pnpm typecheck` and `git diff --check` passed. The initial default-timeout run hit the existing snapshot-cache test's 5-second limit; the 30-second rerun passed.
- Sol findings ledger: round 1, GPT 6.1 Sol (`gpt-6.1-sol`, high effort), APPROVE; no findings, fixes, or declined items. Reviewer independently reran the 39 tests, typecheck, and diff check successfully. Implementation diff before/after review: 8 files, +95/−20 (documentation outcome update excluded); usage not exposed. No push.
