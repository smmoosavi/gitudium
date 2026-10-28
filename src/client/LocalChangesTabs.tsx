import type { LocalChanges, LocalScope } from "../repository/types";
import { localFiles, localScopes } from "./localChanges";

export function LocalChangesTabs({ changes, scope, onChange }: { changes: LocalChanges; scope: LocalScope; onChange: (scope: LocalScope) => void }) {
  return <div className="local-tabs" role="tablist" aria-label="Local changes scope">
    {localScopes.map((option, index) => <button key={option.value} id={`local-tab-${option.value}`} type="button" role="tab"
      aria-selected={scope === option.value} aria-controls="local-files" tabIndex={scope === option.value ? 0 : -1}
      title={option.description} onClick={() => onChange(option.value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? localScopes.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + localScopes.length) % localScopes.length;
        onChange(localScopes[next]!.value);
        (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
      }}>{option.label}<span className="count">{localFiles(changes, option.value).length}</span></button>)}
  </div>;
}
