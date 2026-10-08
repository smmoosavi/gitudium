import { useEffect, useId, useRef, useState } from "react";
import type { Reference } from "../repository/types";
import { completeReference, normalizeSelection, referenceOptions, selectionToken, type ReferenceOption } from "./referenceSelection";

interface Props {
  value: string;
  references: Reference[];
  onChange: (value: string) => void;
}

export function ReferenceSelector({ value, references, onChange }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [active, setActive] = useState(-1);
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
  const ordered = groups.flatMap(group => options.filter(option => option.group === group));
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
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  return <div className="reference-selector" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); apply(); }
  }}>
    <div className="reference-input-row">
      <input ref={input} id="reference" role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={listId} aria-activedescendant={open && active >= 0 && active < ordered.length ? `${listId}-${active}` : undefined}
        aria-describedby={helpId} autoComplete="off" spellCheck={false} value={draft} placeholder="All references + HEAD"
        onFocus={() => setOpen(true)} onClick={event => { setCaret(event.currentTarget.selectionStart ?? draft.length); setActive(-1); setOpen(true); }}
        onSelect={event => setCaret(event.currentTarget.selectionStart ?? draft.length)}
        onChange={event => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setActive(-1); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(current => ordered.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length : -1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && ordered[active]) choose(ordered[active]);
            else { apply(); setOpen(false); }
          } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
        }} />
      <button type="button" aria-label="Apply reference selection" onClick={() => { apply(); setOpen(false); }}>Apply</button>
      {draft && <button type="button" aria-label="Show all references" onClick={() => { setDraft(""); setCaret(0); setActive(-1); apply(""); }}>×</button>}
    </div>
    <span id={helpId} className="reference-help">Separate with , · ! excludes history · * matches refs</span>
    {open && <div id={listId} role="listbox" aria-label="References" className="reference-options">
      {groups.map(group => <div role="group" aria-label={group} key={group}>
        <div className="reference-group" aria-hidden="true">{group}</div>
        {ordered.map((option, index) => option.group === group && <div key={option.name} id={`${listId}-${index}`} role="option"
          aria-selected={active === index} className="reference-option" title={option.name}
          onPointerDown={event => { event.preventDefault(); choose(option); }} onPointerMove={() => setActive(index)}>
          {token.negative ? "!" : ""}{option.value}
        </div>)}
      </div>)}
      {!ordered.length && <div className="reference-no-results">No matching refs. Press Enter to apply a revision or pattern.</div>}
    </div>}
  </div>;
}
