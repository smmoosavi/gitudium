import { useEffect, useId, useRef, useState } from "react";
import type { Reference } from "../repository/types";
import { completeReference, completionIndex, normalizeSelection, referenceEnterAction, referenceOptions, selectionToken, type ReferenceOption } from "./referenceSelection";

interface Props {
  value: string;
  references: Reference[];
  onChange: (value: string) => void;
  onCommitFocus: () => void;
}

export function ReferenceSelector({ value, references, onChange, onCommitFocus }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(-1);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLInputElement>(null);
  const applied = useRef(value);
  const listId = useId();
  const helpId = useId();
  useEffect(() => {
    if (value !== applied.current) { setDraft(value); setCaret(value.length); setActive(-1); }
    applied.current = value;
  }, [value]);
  const token = selectionToken(draft, caret);
  const options = referenceOptions(references).filter(option =>
    option.value.toLowerCase().includes(token.query.toLowerCase()) || option.name.toLowerCase().includes(token.query.toLowerCase()));
  const groups = [...new Set(options.map(option => option.group))];
  const ordered = groups.flatMap(group => collapsed.has(group) ? [] : options.filter(option => option.group === group));
  const selectedIndex = completionIndex(token.query, active, ordered.length);
  const toggleGroup = (group: string) => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
    setActive(-1);
  };
  const apply = (text = draft) => {
    applied.current = normalizeSelection(text);
    onChange(applied.current);
  };
  const choose = (option: ReferenceOption) => {
    const completed = completeReference(draft, caret, option);
    setDraft(completed.text);
    setCaret(completed.caret);
    setActive(-1);
    setOpen(true);
    apply(completed.text);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(completed.caret, completed.caret); });
  };
  useEffect(() => {
    if (open && selectedIndex >= 0) document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open, listId]);
  return <div className="reference-selector" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); apply(); }
  }}>
    <div className="reference-input-row">
      <input ref={input} id="reference" role="combobox" aria-label="References" aria-autocomplete="list" aria-expanded={open}
        aria-controls={listId} aria-activedescendant={open && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined}
        aria-describedby={helpId} autoComplete="off" spellCheck={false} value={draft} placeholder="All references + HEAD"
        onFocus={() => setOpen(true)} onClick={event => { setCaret(event.currentTarget.selectionStart ?? draft.length); setActive(-1); setOpen(true); }}
        onSelect={event => setCaret(event.currentTarget.selectionStart ?? draft.length)}
        onChange={event => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(ordered.length ? (selectedIndex < 0
              ? event.key === "ArrowDown" ? 0 : ordered.length - 1
              : (selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length) : -1);
          } else if (event.key === "Enter" || event.key === ",") {
            const option = open ? ordered[selectedIndex] : undefined;
            const action = referenceEnterAction(open, !!option);
            if (action === "complete" && option) { event.preventDefault(); choose(option); }
            else if (event.key === "Enter") {
              event.preventDefault();
              if (action === "apply") { apply(); setOpen(false); }
              else onCommitFocus();
            }
          } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
        }} />
      {draft && <button type="button" aria-label="Show all references" onClick={() => { setDraft(""); setCaret(0); setActive(-1); apply(""); }}>×</button>}
    </div>
    <span id={helpId} className="reference-help">Separate with , · ! excludes history · * matches refs</span>
    {open && <div id={listId} role="listbox" aria-label="References" className="reference-options">
      {groups.map(group => <div role={group ? "group" : undefined} aria-label={group || undefined} key={group}>
        {group && <button type="button" className="reference-group" aria-expanded={!collapsed.has(group)}
          onPointerDown={event => event.preventDefault()} onClick={() => toggleGroup(group)}>
          <span aria-hidden="true">{collapsed.has(group) ? "▸" : "▾"} </span>{group}
        </button>}
        {ordered.map((option, index) => option.group === group && <div key={option.name} id={`${listId}-${index}`} role="option"
          aria-selected={selectedIndex === index} className="reference-option" title={option.name}
          onPointerDown={event => { event.preventDefault(); choose(option); }} onPointerMove={() => setActive(index)}>
          {token.negative ? "!" : ""}{option.value}
        </div>)}
      </div>)}
      {!options.length && <div className="reference-no-results">No matching refs. Press Enter to apply a revision or pattern.</div>}
    </div>}
  </div>;
}
