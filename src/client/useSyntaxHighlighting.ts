import { useEffect, useRef, useState } from "react";
import type { SyntaxService } from "./syntaxService";
import { syntaxSourceKey, syntaxSourcesWithinLimit } from "./syntaxTypes";
import type { SyntaxResult, SyntaxSources } from "./syntaxTypes";

export function useSyntaxHighlighting(service: SyntaxService, sources: SyntaxSources | undefined): SyntaxResult | undefined {
  const key = sources && syntaxSourcesWithinLimit(sources) ? syntaxSourceKey(sources) : undefined;
  const latestSources = useRef(sources);
  latestSources.current = sources;
  const [state, setState] = useState<{ service: SyntaxService; key: string; result: SyntaxResult }>();

  useEffect(() => service.request(key === undefined ? undefined : latestSources.current, result => {
    setState(result && key !== undefined ? { service, key, result } : undefined);
  }), [service, key]);

  return state?.service === service && state.key === key ? state.result : undefined;
}
