# Commit graph routing and maintenance

Status: Implemented on `refactor/graph-routing-maintenance`; final validation is recorded below.

## Goal and governing specification

Make graph relationships easier to preserve, inspect, and test while retaining the compact, priority-aware layout required by [the graph specification](../specs/graph.md).

Preserve branch priorities, straight first-parent spines, rightward forks, late visual branching, safe lane reuse, and bounded graph viewport sizing. Layout decisions must remain independent of viewport width and horizontal scrolling.

## Problem and evidence

The README branch and `local-diff` branch both descend from `e02d6f0`. Routing the README connection into the parent lane immediately below `cfc68e0` caused it to pass through the unrelated `5ce8a37` commit dot, falsely suggesting an ancestor relationship.

The early join followed the specification's compactness preference. The defect was allowing that route to create an accidental junction. The existing test for early joining checked the preferred shape without checking whether intervening commits made that shape unsafe.

The corrective patch keeps the side connection separate until its actual parent. This addresses the reported false junction but is not a complete routing policy: always retaining that lane can create long parallel lines and additional width, contrary to the late-branching preference. Reconcile both constraints during implementation; do not make permanent lane reservation the general solution.

## Responsibility boundaries

- [graph.ts](../src/client/graph.ts) combines relationship indexing, priorities, track construction, pagination stability, lane allocation, connection routing, and row generation. Shared mutable state makes their dependencies implicit. In particular, track lifetime mixes node occupancy with connection occupancy.
- `GraphEdge` stores lane numbers without identifying the child and parent. Passing connections become anonymous lane numbers in `above` and `below`, making topology difficult to verify after routing.
- [CommitGraph.tsx](../src/client/CommitGraph.tsx) interprets routing conventions as well as drawing SVG paths. The layout and renderer jointly decide the visible connections.
- [graphViewport.ts](../src/client/graphViewport.ts) enumerates the same row representation to compute width. Adding a new segment category requires coordinated changes across layout, rendering, and measurement.

Extract cohesive graph responsibilities with explicit contracts, rather than moving individual loops into a general utilities file. Keep helpers local until they have a useful independent contract.

## Implementation sequence

### 1. Establish correctness checks before restructuring

- Retain the reported history as a regression fixture.
- Add reusable checks that every declared parent connection reaches its intended endpoint or remains open at a pagination boundary, and that no connection passes through an unrelated commit dot.
- Check segment continuity between rows and complete representation of merge parents. Distinguish geometric crossings from graph junctions explicitly.
- Exercise these checks with small deterministic generated histories, valid alternate topological orders, merges, disconnected histories, and partial pages.
- Keep tests for compactness, branch priorities, straight spines, and lane reuse. Exact lane expectations express layout preferences; they do not establish topology correctness by themselves.

### 2. Preserve relationship identity through routing

- Represent each connection using its child ID, parent ID, and parent position, retaining the distinction between first and additional parents.
- Represent an unloaded parent explicitly as an open endpoint rather than a root.
- Keep connection identities attached to intermediate routes so validation and diagnostics can trace segments back to repository relationships.
- Define occupied space for nodes and passing connections separately. Sharing a lane must not silently connect a route to an unrelated node.

### 3. Separate layout stages with explicit contracts

- Build topology and priority-aware tracks without producing SVG instructions.
- Determine connection constraints and assign lanes with those constraints available. Keep dependencies explicit if routing and allocation require an iterative solution; do not assume routing can always be added after lane allocation.
- Prefer the compact parent-lane route where it preserves topology. Where it would create a false junction, choose a safe alternative while minimizing extra width and bends.
- Preserve previous lane assignments where possible during pagination, subject to correctness and branch-priority constraints.
- Keep `layoutCommitGraph` as the public orchestration entry point. Extract focused pure functions and types; split files only where the responsibility boundary is useful.

### 4. Give row geometry one owner

- Convert routed connections into a complete per-row drawing plan, retaining connection identity for testing and diagnostics.
- Make the React component draw that plan without inferring which connections join or suppressing segments based on routing conventions.
- Derive occupied lane bounds from the same plan so viewport measurement includes every visible segment.
- Keep viewport caps, scrolling, shrink delay, and animation in the display layer. They must never feed back into topology or lane assignment.

## Acceptance and validation

- The reported history has no false connection through `5ce8a37`; both branches reach `e02d6f0` correctly.
- Safe compact histories still branch late and reuse lanes. Passing connections reserve only the space their chosen routes need.
- Merge parents, roots, disconnected histories, and unloaded endpoints remain correct.
- Appending history preserves lanes where possible; changing visible rows, pane width, or horizontal offset does not alter the layout.
- Pure routing tests verify meaning and continuity. Focused renderer tests verify that the drawing plan is faithfully rendered; mounted browser coverage verifies clipping, virtualization, and shared scrolling.
- Run targeted graph tests and `pnpm typecheck` after each implementation step. Before completion, run `pnpm test`, `pnpm build`, and relevant browser tests; record unrelated baseline failures separately.
- Keep mechanical extraction and routing behavior changes in reviewable commits. Reconcile the corrective patch and its changed compactness expectations against the specification rather than treating all current test expectations as authoritative.

## Scope limits

No graph library replacement, generic utility framework, pagination redesign, viewport redesign, or application-wide state refactor is required. Update the specification only if an actual product behavior decision is needed; extracting responsibilities must not silently redefine its layout rules.


## Implementation record

- `graphTopology.ts` builds relationship indexes, inherited priorities, and first-parent tracks. `graphRouting.ts` computes safe joins and allocates lanes with separate node and passing-connection reservations. Neither stage takes viewport dimensions.
- Every row segment retains its child ID, parent ID, parent position, and open-endpoint status. Additional merge parents use a separate passing lane when intervening nodes on either spine would otherwise create false junctions; that reservation ends at the safe join.
- `graphGeometry.ts` owns the complete row drawing plan, SVG path geometry, lane spacing, and occupied bounds. `CommitGraph.tsx` draws the plan directly, and `graphViewport.ts` measures the same segments.
- Tests retain the reported history and compactness expectations, trace individual connections through deterministic forks and seeded merge DAGs, exercise alternate topological orders and pagination, and check renderer geometry. Mounted coverage exercises clipping, shared keyboard scrolling, stationary text, resizing, and virtualization.
- The specification remains unchanged. Safe connections still join immediately; blocked connections join below the last unrelated dot rather than reserving a lane to the parent unconditionally.

Validation:

- Targeted graph tests and `pnpm typecheck` pass.
- `pnpm test`: 265 passing tests. An earlier run concurrent with the production build hit the existing repository-cache test's five-second timeout; the repository file passed independently, and the final full run passed without concurrent build work.
- `pnpm build` passes, with the dependency's existing tree-sitter externalization and eval warnings.
- Relevant mounted browser tests (`browser/graph.browser.ts` and `browser/app.browser.ts`): nine passing tests. Playwright's browser CDN denied the download, so validation used system Chromium 156 through a temporary `launchOptions.executablePath` override; the repository configuration is unchanged.
