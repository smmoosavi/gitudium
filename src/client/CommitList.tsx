import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { layoutCommitGraph, type CommitGraph as GraphLayout } from "./graph";
import { CommitGraph } from "./CommitGraph";
import { commitRowHeight, graphWidth, graphViewportWidth, graphScrollOffset, visibleGraphLanes } from "./graphViewport";
import { shouldLoadHistory } from "./history";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummary } from "../repository/types";
import { formatDate } from "./date";

export interface CommitListHandle {
  reveal: (index: number, focus: boolean) => void;
}

export const CommitList = forwardRef<CommitListHandle, {
  commits: CommitSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  head?: string | null;
}>(function CommitList({ commits, selected, onSelect, canLoadMore = false, onLoadMore, head = null }, ref) {
  const previousGraph = useRef<GraphLayout | undefined>(undefined);
  const graph = useMemo(() => layoutCommitGraph(commits, head, previousGraph.current), [commits, head]);
  useLayoutEffect(() => { previousGraph.current = graph; }, [graph]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => commitRowHeight,
    getItemKey: index => commits[index]!.id,
    overscan: 8,
  });
  const items = virtualizer.getVirtualItems();
  const visibleLanes = visibleGraphLanes(graph.rows, items.map(item => item.index));
  const [retainedLanes, setRetainedLanes] = useState(visibleLanes);
  const lanes = Math.max(visibleLanes, retainedLanes);
  useEffect(() => {
    if (visibleLanes >= retainedLanes) { setRetainedLanes(visibleLanes); return; }
    const timer = setTimeout(() => setRetainedLanes(visibleLanes), 250);
    return () => clearTimeout(timer);
  }, [visibleLanes, retainedLanes]);
  const [paneWidth, setPaneWidth] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const graphScrollRef = useRef<HTMLDivElement>(null);
  const viewportWidth = graphViewportWidth(lanes, paneWidth);
  const contentWidth = graphWidth(lanes);
  const offset = graphScrollOffset(scrollOffset, contentWidth, viewportWidth);
  const overflowing = contentWidth > viewportWidth;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setPaneWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (graphScrollRef.current) graphScrollRef.current.scrollLeft = offset;
    if (offset !== scrollOffset) setScrollOffset(offset);
  }, [offset, scrollOffset]);
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
      if (index < 0 || index >= commits.length) {
        if (focus) scrollRef.current?.focus({ preventScroll: true });
        return;
      }
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
  return <div className="commit-list" style={{ "--graph-viewport-width": `${viewportWidth}px`, "--graph-offset": `${-offset}px` } as CSSProperties}>
    {overflowing && <div className="graph-overflow-bar">
      <div ref={graphScrollRef} className="graph-horizontal-scroll" tabIndex={0} role="region"
        aria-label="Scroll commit graph horizontally" title="Scroll to see hidden graph lanes"
        onScroll={event => setScrollOffset(event.currentTarget.scrollLeft)}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          setScrollOffset(event.key === "Home" ? 0 : event.key === "End" ? contentWidth - viewportWidth
            : graphScrollOffset(offset + (event.key === "ArrowLeft" ? -32 : 32), contentWidth, viewportWidth));
        }}>
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
      <span className="graph-overflow-hint">↔ More graph lanes</span>
    </div>}
    <div className="commit-scroll" ref={scrollRef} tabIndex={-1} aria-label="Commit history">
    <ol className="commits" aria-label="Commits" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {items.map(item => {
        const commit = commits[item.index]!;
        const metadata = `${commit.shortId} · ${commit.author.name} · ${formatDate(commit.author.date)}`;
        return <li key={item.key} data-index={item.index}
          aria-posinset={item.index + 1} aria-setsize={commits.length}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
          <button data-commit-index={item.index} aria-pressed={selected === commit.id}
            onFocus={() => onSelect(commit.id)} onClick={() => onSelect(commit.id)}>
            <span className="commit-graph-window"><CommitGraph row={graph.rows[item.index]!} width={lanes} /></span>
            {commit.parents.length === 0 && <span className="sr-only">Root commit. </span>}
            <strong title={commit.subject || "(No subject)"}>{commit.subject || "(No subject)"}</strong>
            <span className="commit-metadata" title={metadata}><code>{commit.shortId}</code> · {commit.author.name} · <time dateTime={commit.author.date}>{formatDate(commit.author.date)}</time></span>
            {commit.references.length > 0 && <span className="labels" title={commit.references.join("\n")}>
              <span className="ref-label">{commit.references[0]!.replace(/^refs\/(heads|remotes|tags)\//, "")}</span>
              {commit.references.length > 1 && <span className="ref-overflow">+{commit.references.length - 1}</span>}
            </span>}
          </button>
        </li>;
      })}
    </ol>
    </div>
  </div>;
});
