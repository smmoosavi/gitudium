import { Fragment, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CommitSummary } from "../repository/types";
import type { GraphRow } from "./graph";
import { CommitGraph } from "./CommitGraph";
import { revealRow, rowAt, rowOffsets, visibleRows } from "./virtual";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
});
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function CommitList({ commits, graph, selected, onSelect, scroller }: {
  commits: CommitSummary[];
  graph: { rows: GraphRow[]; columns: number };
  selected: string | null;
  onSelect: (id: string) => void;
  scroller: RefObject<HTMLElement | null>;
}) {
  const list = useRef<HTMLOListElement>(null);
  const heights = useRef(new Map<string, number>());
  const [measurement, measure] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focused, setFocused] = useState<string | null>(null);
  const [request, setRequest] = useState<{ index: number; focus: boolean } | null>(null);
  const ids = useMemo(() => commits.map(commit => commit.id), [commits]);
  const offsets = useMemo(() => rowOffsets(ids, heights.current), [ids, measurement]);
  const indices = visibleRows(offsets, viewport.top, viewport.height, ids.indexOf(focused ?? ""));
  const previous = useRef(offsets);

  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [scroller]);

  useLayoutEffect(() => {
    const panel = scroller.current;
    const element = list.current;
    if (!panel || !element) return;
    const update = () => setViewport({ top: Math.max(0, panel.scrollTop - element.offsetTop), height: panel.clientHeight });
    let width = panel.clientWidth;
    let height = panel.clientHeight;
    const observer = new ResizeObserver(() => {
      const resized = panel.clientWidth !== width || panel.clientHeight !== height;
      if (panel.clientWidth !== width) {
        width = panel.clientWidth;
        heights.current.clear();
        measure(value => value + 1);
      }
      height = panel.clientHeight;
      if (resized) {
        const index = ids.indexOf(selected ?? "");
        if (index >= 0) setRequest({ index, focus: false });
      }
      update();
    });
    observer.observe(panel);
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number; focus: boolean }>).detail;
      const index = detail.index ?? ids.indexOf(selected ?? "");
      if (index >= 0 && index < ids.length) setRequest(current => ({ index, focus: detail.focus || (current?.index === index && current.focus) }));
    };
    element.addEventListener("commit-navigation", navigate);
    panel.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("commit-navigation", navigate);
      panel.removeEventListener("scroll", update);
    };
  }, [scroller, ids, selected]);

  useLayoutEffect(() => {
    const panel = scroller.current;
    const element = list.current;
    if (!panel || !element) return;
    // Keep the visible row anchored as estimates are replaced with measured heights.
    if (previous.current !== offsets && !request && previous.current.length === offsets.length) {
      const anchor = rowAt(previous.current, viewport.top);
      if (anchor >= 0) panel.scrollTop += offsets[anchor]! - previous.current[anchor]!;
    }
    previous.current = offsets;
    if (request) {
      const top = Math.max(0, panel.scrollTop - element.offsetTop);
      panel.scrollTop = element.offsetTop + revealRow(offsets, request.index, top, panel.clientHeight);
      const target = element.querySelector<HTMLButtonElement>(`button[data-commit-index="${request.index}"]`);
      if (target) {
        if (request.focus) target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        setRequest(null);
      }
    }
    setViewport(current => {
      const top = Math.max(0, panel.scrollTop - element.offsetTop);
      return current.top === top && current.height === panel.clientHeight ? current : { top, height: panel.clientHeight };
    });
  }, [offsets, request, viewport.top, scroller]);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.commitId!;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (height > 0 && heights.current.get(id) !== height) {
          heights.current.set(id, height);
          changed = true;
        }
      }
      if (changed) measure(value => value + 1);
    });
    for (const row of element.querySelectorAll<HTMLElement>("li[data-commit-id]")) observer.observe(row);
    return () => observer.disconnect();
  }, [indices.join(","), commits, graph.columns, measurement]);

  let end = 0;
  return <ol ref={list} className="commits virtual-commits" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
  }}>
    {indices.map(index => {
      const commit = commits[index]!;
      const gap = offsets[index]! - end;
      end = offsets[index + 1]!;
      return <Fragment key={commit.id}>
        {gap > 0 && <li role="presentation" aria-hidden="true" style={{ height: gap }} />}
        <li data-commit-id={commit.id} aria-posinset={index + 1} aria-setsize={commits.length}>
          <button data-commit-index={index} aria-pressed={selected === commit.id} onFocus={() => { setFocused(commit.id); onSelect(commit.id); }} onClick={() => onSelect(commit.id)}>
            <CommitGraph row={graph.rows[index]!} columns={graph.columns} root={commit.parents.length === 0} />
            <div className="commit-text">
              <strong>{commit.subject || "(No subject)"}</strong>
              <span><code>{commit.shortId}</code> · {commit.author.name} · <time dateTime={commit.author.date} title={commit.author.date}>{formatDate(commit.author.date)}</time></span>
              {commit.references.length > 0 && <span className="labels">{commit.references.map(reference => <span className="ref-label" key={reference}>{reference.replace(/^refs\/(heads|remotes|tags)\//, "")}</span>)}</span>}
              <span className="sr-only">{commit.parents.length === 0 ? "Root commit" : `Parents: ${commit.parents.map(parent => parent.slice(0, 7)).join(", ")}`}</span>
            </div>
          </button>
        </li>
      </Fragment>;
    })}
    {offsets.at(-1)! > end && <li role="presentation" aria-hidden="true" style={{ height: offsets.at(-1)! - end }} />}
  </ol>;
}
