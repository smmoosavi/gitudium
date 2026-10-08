import type { Ref } from "react";
import { CommitList, type CommitListHandle } from "./CommitList";
import type { CommitSummary, Reference } from "../repository/types";
import { Failure } from "./Failure";
import { ReferenceSelector } from "./ReferenceSelector";
import type { FocusedPane } from "./navigation";

interface HistoryPaneProps {
  historyRef: Ref<HTMLElement>;
  commitListRef: Ref<CommitListHandle>;
  focusedPane: FocusedPane;
  onPaneFocus: (pane: FocusedPane) => void;
  revision: string;
  onRevisionChange: (revision: string) => void;
  references: Reference[] | undefined;
  referencesPending: boolean;
  referencesSuccess: boolean;
  referencesError: Error | null;
  onReferencesRetry: () => void;
  historyPending: boolean;
  historySuccess: boolean;
  historyError: Error | null;
  onHistoryRetry: () => void;
  commits: CommitSummary[];
  head: string | null | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  canLoadMore: boolean;
  onLoadMore: () => void;
  fetchingNextPage: boolean;
}

export function HistoryPane({ historyRef, commitListRef, focusedPane, onPaneFocus, revision, onRevisionChange,
  references, referencesPending, referencesSuccess, referencesError, onReferencesRetry,
  historyPending, historySuccess, historyError, onHistoryRetry, commits, head, selected, onSelect,
  canLoadMore, onLoadMore, fetchingNextPage }: HistoryPaneProps) {
  return (
      <section ref={historyRef} className={`history-panel${focusedPane === "commits" ? " pane-focused" : ""}`} aria-labelledby="history-title" onPointerDown={() => onPaneFocus("commits")} onFocusCapture={() => onPaneFocus("commits")}>
        <div className="panel-heading"><h2 id="history-title">Log</h2></div>
        <div className="history-toolbar">
        <ReferenceSelector value={revision} references={references ?? []} onChange={onRevisionChange} /></div>
        {referencesPending && <p role="status">Loading references…</p>}
        {referencesError && <Failure error={referencesError} retry={onReferencesRetry} />}
        {historyPending && <p role="status">Loading history…</p>}
        {historyError && <Failure error={historyError} retry={onHistoryRetry} />}
        {historySuccess && commits.length === 0 && <p>No commits in this history.</p>}
        <CommitList key={revision} ref={commitListRef} commits={commits} head={head} selected={selected} onSelect={onSelect}
          canLoadMore={canLoadMore} onLoadMore={onLoadMore} />
        {fetchingNextPage && <p role="status">Loading more history…</p>}
      </section>
  );
}
