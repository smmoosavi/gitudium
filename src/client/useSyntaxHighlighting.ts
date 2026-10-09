import { useEffect, useRef, useState } from "react";
import { SyntaxService } from "./syntaxService";
import { syntaxSourceKey, syntaxSourcesWithinLimit } from "./syntaxTypes";
import type { SyntaxResult, SyntaxSources } from "./syntaxTypes";

export function useSyntaxHighlighting(sources: SyntaxSources | undefined): SyntaxResult | undefined {
  const key = sources && syntaxSourcesWithinLimit(sources) ? syntaxSourceKey(sources) : undefined;
  const latestSources = useRef(sources);
  latestSources.current = sources;
  const service = useRef<SyntaxService | undefined>(undefined);
  const [state, setState] = useState<{ key: string; result: SyntaxResult }>();

  useEffect(() => {
    service.current = new SyntaxService();
    return () => {
      service.current?.dispose();
      service.current = undefined;
    };
  }, []);

  useEffect(() => service.current?.request(key === undefined ? undefined : latestSources.current, result => {
    setState(result && key !== undefined ? { key, result } : undefined);
  }), [key]);

  return state?.key === key ? state?.result : undefined;
}
