import { useCallback, useRef, type Ref } from "react";
import { CommitList, type CommitListHandle } from "./CommitList";
import type { CommitSummary, Reference } from "../repository/types";
import { Failure } from "./Failure";
import { ReferenceSelector } from "./ReferenceSelector";
import { LogSettings } from "./LogSettings";
import type { FocusedPane } from "./navigation";

interface HistoryPaneProps {
  historyRef: Ref<HTMLElement>;
  commitListRef: Ref<CommitListHandle>;
  focusedPane: FocusedPane;
  onPaneFocus: (pane: FocusedPane) => void;
  refExclusions?: string;
  onRefExclusionsChange?: (value: string) => void;
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
  localChanges?: { count: number | undefined; selected: boolean; pending: boolean; error: boolean; onSelect: () => void };
}

export function HistoryPane({ historyRef, commitListRef, focusedPane, onPaneFocus, revision, onRevisionChange, refExclusions = "", onRefExclusionsChange,
  references, referencesPending, referencesSuccess, referencesError, onReferencesRetry,
  historyPending, historySuccess, historyError, onHistoryRetry, commits, head, selected, onSelect,
  canLoadMore, onLoadMore, fetchingNextPage, localChanges }: HistoryPaneProps) {
  const listRef = useRef<CommitListHandle>(null);
  const setListRef = useCallback((handle: CommitListHandle | null) => {
    listRef.current = handle;
    if (typeof commitListRef === "function") return commitListRef(handle);
    if (commitListRef) commitListRef.current = handle;
  }, [commitListRef]);
  const focusCommits = () => {
    onPaneFocus("commits");
    if (localChanges?.selected || (localChanges && !commits.length)) {
      localChanges.onSelect();
      if (historyRef && typeof historyRef !== "function") historyRef.current?.querySelector<HTMLButtonElement>(".local-changes-row")?.focus();
      return;
    }
    const index = Math.max(0, commits.findIndex(commit => commit.id === selected));
    if (commits[index]) onSelect(commits[index].id);
    listRef.current?.reveal(index, true);
  };
  return (
      <section ref={historyRef} className={`history-panel${focusedPane === "commits" ? " pane-focused" : ""}`} aria-labelledby="history-title" onPointerDown={() => onPaneFocus("commits")} onFocusCapture={() => onPaneFocus("commits")}>
        <div className="panel-heading log-heading"><h2 id="history-title">Log</h2>{onRefExclusionsChange && <LogSettings value={refExclusions} onChange={onRefExclusionsChange} />}</div>
        <div className="history-toolbar">
        <ReferenceSelector value={revision} references={references ?? []} onChange={onRevisionChange} onCommitFocus={focusCommits} /></div>
        {localChanges && <div className="local-changes-pinned"><button type="button" className="local-changes-row" aria-pressed={localChanges.selected}
          onFocus={localChanges.onSelect} onClick={localChanges.onSelect}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 3h10l4 4v14H5Z M14 3v5h5 M8 12h8 M8 16h5" /></svg>
          <span><strong>Local changes</strong><small>{localChanges.error ? "Refresh failed · Select to retry" : localChanges.pending ? "Checking working tree…" : localChanges.count === 0 ? "Working tree clean" : "Staged, unstaged & untracked"}</small></span>
          {localChanges.count !== undefined && <span className="local-count">{localChanges.count}</span>}
        </button></div>}
        {referencesPending && <p role="status">Loading references…</p>}
        {referencesError && <Failure error={referencesError} retry={onReferencesRetry} />}
        {historyPending && <p role="status">Loading history…</p>}
        {historyError && <Failure error={historyError} retry={onHistoryRetry} />}
        {historySuccess && commits.length === 0 && <p>No commits in this history.</p>}
        <CommitList key={revision} ref={setListRef} commits={commits} head={head} selected={selected} onSelect={onSelect}
          canLoadMore={canLoadMore} onLoadMore={onLoadMore} />
        {fetchingNextPage && <p role="status">Loading more history…</p>}
      </section>
  );
}
