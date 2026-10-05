import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { shouldLoadHistory } from "./history";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummary } from "../repository/types";

export interface CommitListHandle {
  reveal: (index: number, focus: boolean) => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

export const CommitList = forwardRef<CommitListHandle, {
  commits: CommitSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
}>(function CommitList({ commits, selected, onSelect, canLoadMore = false, onLoadMore }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 84,
    getItemKey: index => commits[index]!.id,
    overscan: 8,
  });
  const focusPending = () => {
    if (pendingFocus.current === null) return;
    const button = scrollRef.current?.querySelector<HTMLButtonElement>(`button[data-commit-index="${pendingFocus.current}"]`);
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  };
  useImperativeHandle(ref, () => ({
    reveal(index, focus) {
      if (index < 0 || index >= commits.length) return;
      pendingFocus.current = focus ? index : null;
      virtualizer.scrollToIndex(index, { align: "auto" });
      focusPending();
    },
  }));
  useLayoutEffect(focusPending);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !canLoadMore || !onLoadMore) return;
    let requested = false;
    const check = () => {
      if (!requested && shouldLoadHistory(element.scrollTop, element.clientHeight, element.scrollHeight)) {
        requested = true;
        onLoadMore();
      }
    };
    element.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(element);
    check();
    return () => { element.removeEventListener("scroll", check); observer.disconnect(); };
  }, [canLoadMore, onLoadMore, commits.length]);
  return <div className="commit-scroll" ref={scrollRef}>
    <ol className="commits" aria-label="Commits" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map(item => {
        const commit = commits[item.index]!;
        return <li key={item.key} data-index={item.index} ref={virtualizer.measureElement}
          aria-posinset={item.index + 1} aria-setsize={commits.length}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
          <button data-commit-index={item.index} aria-pressed={selected === commit.id}
            onFocus={() => onSelect(commit.id)} onClick={() => onSelect(commit.id)}>
            <strong>{commit.subject || "(No subject)"}</strong>
            <span><code>{commit.shortId}</code> · {commit.author.name} · <time dateTime={commit.author.date} title={commit.author.date}>{formatDate(commit.author.date)}</time></span>
            {commit.references.length > 0 && <span className="labels">{commit.references.map(reference => <span className="ref-label" key={reference}>{reference.replace(/^refs\/(heads|remotes|tags)\//, "")}</span>)}</span>}
          </button>
        </li>;
      })}
    </ol>
  </div>;
});
