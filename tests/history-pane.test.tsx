import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { HistoryPane } from "../src/client/HistoryPane";

function render(overrides: Partial<ComponentProps<typeof HistoryPane>> = {}) {
  return renderToStaticMarkup(<HistoryPane historyRef={null} commitListRef={null} focusedPane="commits"
    onPaneFocus={() => {}} revision="" onRevisionChange={() => {}} references={undefined}
    referencesPending={false} referencesSuccess={false} referencesError={null} onReferencesRetry={() => {}}
    historyPending={false} historySuccess={false} historyError={null} onHistoryRetry={() => {}}
    commits={[]} head={null} selected={null} onSelect={() => {}} canLoadMore={false}
    onLoadMore={() => {}} fetchingNextPage={false} {...overrides} />);
}

test("history pane preserves independent loading, empty, error and pagination states", () => {
  const loading = render({ referencesPending: true, historyPending: true });
  expect(loading).toContain("Loading references…");
  expect(loading).toContain("Loading history…");
  expect(loading).not.toContain("No commits in this history.");
  expect(render({ historySuccess: true })).toContain("No commits in this history.");
  expect(render({ fetchingNextPage: true })).toContain("Loading more history…");
  const errors = render({ referencesError: new Error("reference failure"), historyError: new Error("history failure") });
  expect(errors).toContain("reference failure");
  expect(errors).toContain("history failure");
  expect(errors.match(/role="alert"/g)).toHaveLength(2);
  expect(errors.match(/>Retry</g)).toHaveLength(2);
});

test("history pane retains unavailable filters and excludes non-commit references", () => {
  const html = render({ revision: "refs/heads/missing", referencesSuccess: true, references: [
    { name: "refs/heads/main", kind: "branch", objectId: "main", commitId: "main", symbolicTarget: null },
    { name: "refs/tags/blob", kind: "tag", objectId: "blob", commitId: null, symbolicTarget: null },
  ] });
  expect(html).toContain('value="refs/heads/missing" selected=""');
  expect(html).toContain("refs/heads/missing (unavailable)");
  expect(html).toContain("refs/heads/main");
  expect(html).not.toContain("refs/tags/blob");
  expect(html).toContain("pane-focused");
  expect(render({ focusedPane: "diff" })).not.toContain("pane-focused");
});
