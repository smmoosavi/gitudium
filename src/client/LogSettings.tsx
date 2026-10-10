import { useId, useRef, useState } from "react";
import { isRefExclusions, refExclusionPatterns } from "../repository/validation";

export function LogSettings({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const valid = isRefExclusions(draft);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <>
    <button ref={button} type="button" className="log-settings-toggle" aria-label="Log settings" title="Log settings" aria-expanded={open} aria-controls={id} onClick={() => { setDraft(value); setOpen(current => !current); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M19.69 9.79 L21.85 10.26 L21.85 13.74 L19.69 14.21 L19 15.88 L20.19 17.74 L17.74 20.19 L15.88 19 L14.21 19.69 L13.74 21.85 L10.26 21.85 L9.79 19.69 L8.12 19 L6.26 20.19 L3.81 17.74 L5 15.88 L4.31 14.21 L2.15 13.74 L2.15 10.26 L4.31 9.79 L5 8.12 L3.81 6.26 L6.26 3.81 L8.12 5 L9.79 4.31 L10.26 2.15 L13.74 2.15 L14.21 4.31 L15.88 5 L17.74 3.81 L20.19 6.26 L19 8.12 Z" /><circle cx="12" cy="12" r="3.5" /></svg>
    </button>
    {open && <form id={id} className="log-settings" aria-label="Log settings" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onSubmit={event => { event.preventDefault(); if (valid) { onChange(refExclusionPatterns(draft).join(", ")); close(); } }}>
      <label htmlFor={`${id}-exclude`}>Exclude refs</label>
      <input autoFocus id={`${id}-exclude`} value={draft} maxLength={1024} placeholder="refs/agents/*, foo, bar" aria-describedby={`${id}-help`} aria-invalid={!valid} onChange={event => setDraft(event.target.value)} />
      <p id={`${id}-help`}>Comma-separated ref names or patterns. Bare names match local branches. Shared history and HEAD remain visible; explicit References selections override these exclusions. Saved for this browser origin, across repositories.</p>
      {!valid && <p role="alert">Use ref patterns, without spaces inside a pattern, leading !, or leading -.</p>}
      <div className="log-settings-actions"><button type="button" onClick={close}>Cancel</button><button type="submit" disabled={!valid}>Save</button></div>
    </form>}
  </>;
}
