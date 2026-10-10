import { useEffect, useMemo, useState } from "react";
import { createDiffEngine } from "./diffEngine";
import type { MatchResult } from "./syntaxMatcher";
import { syntaxSourcesWithinLimit, type SyntaxSources } from "./syntaxTypes";

export function useSyntaxMatcher(enabled: boolean, sources: SyntaxSources | undefined) {
  const [state, setState] = useState<{ sources: SyntaxSources; result?: MatchResult }>();
  useEffect(() => {
    if (!enabled || !sources || !syntaxSourcesWithinLimit(sources)) return;
    let active = true;
    const worker = new Worker(new URL("./syntaxMatch.worker.ts", import.meta.url), { type: "module" });
    const finish = (result?: MatchResult) => {
      if (active) setState({ sources, result });
      clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = setTimeout(() => finish(), 5000);
    worker.onmessage = (event: MessageEvent<{ result?: MatchResult }>) => finish(event.data.result);
    worker.onerror = () => finish();
    worker.onmessageerror = () => finish();
    worker.postMessage(sources);
    return () => { active = false; clearTimeout(timeout); worker.terminate(); };
  }, [enabled, sources]);
  const result = enabled && state?.sources === sources ? state?.result : undefined;
  const engine = useMemo(() => result ? createDiffEngine(true, result) : undefined, [result]);
  const eligible = !!sources && syntaxSourcesWithinLimit(sources);
  return { engine, pending: enabled && eligible && state?.sources !== sources, unavailable: enabled && (!eligible || (state?.sources === sources && !result)) };
}
