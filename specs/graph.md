## Compact, priority-aware commit graph

Display commit history as a clear, compact graph optimized for **rebase-based workflows**, while correctly supporting merges, standalone commits, and disconnected histories.

### Branch priority

Arrange overlapping branch histories from left to right:

1. **Main branches:** `main`, `trunk`, `mainline`, `default`, `stable`, `master`
2. **Development branches:** `dev`, `devel`, `develop`, `development`
3. **HEAD**
4. **Feature and other branches**

Recognize main and development names under `refs/heads/`, `refs/remotes/origin/`, and `refs/remotes/upstream/`.

### History ordering

- Order independent commits by branch priority, keeping every child above all its parents, including merge parents. Preserve Git's order when priorities tie; commit dates do not override topology or branch priority.
- Apply ordering within each loaded history page and propagate first-parent priorities across pages. Preserve loaded page boundaries so appending history does not reshuffle existing rows; an independent tip may remain above a higher-priority continuation in a later page.
- Use the same display order for graph rows, commit text, selection, and keyboard navigation. Viewport width and horizontal scrolling must not affect it.

### Visual layout rules

- **Prefer straight lines.** Continue vertically whenever possible; a branch label or reference alone should not cause a bend.
- **Keep important histories on the left.** Their first-parent histories form stable, straight spines.
- **Extend existing spines upward.** When a main, development, or HEAD tip has descendants, the first suitable child continues its lane; additional children fork right.
- **Fork actual side branches to the right**, never to the left of their parent spine.
- **Branch as late as possible visually.** Keep the shared connection in the parent lane until just below the side branch’s first unique commit, rather than drawing many parallel lines from a distant shared ancestor.
- **Reuse available space.** Independent or non-overlapping histories can reuse free left-side lanes, provided this does not create a leftward fork, cross an active history, or disrupt a straight continuation.
- **Avoid unnecessary width.** Short-lived branches and standalone commits should not permanently reserve columns.

### Adaptive graph viewport

- **Keep layout separate from display sizing.** Adapt graph width to visible rows and overscan, including passing connections, without changing topology or lane assignments.
- **Protect text space.** Cap graph width at **35% of the commits pane or 180 px**, whichever is smaller. Keep lane spacing readable.
- **Handle overflow within the graph.** Provide a shared, keyboard-accessible horizontal scrollbar and a subtle overflow hint; keep commit text stationary.
- **Resize smoothly.** Expand promptly, delay shrinking briefly to avoid jitter, and animate width changes gently. Respect reduced-motion preferences.

### Correctness and interaction

- Show every parent connection for merge commits.
- Keep unrelated histories disconnected and clearly mark root commits.
- Extend the graph as more history is loaded, preserving existing lanes where possible.
- Keep connections to unloaded parents open at pagination boundaries rather than treating those commits as roots.
- Preserve commit selection, reference filtering, keyboard navigation, and virtualized scrolling.
- Changing graph viewport width or horizontal offset must not change commit ordering, graph topology, or lane assignments.

**Goal:** a graph where the main history is easy to follow, branches appear only where needed, and horizontal space reflects concurrent histories—not the total number of branches. Even dense historical sections must leave commit text readable and row heights predictable.