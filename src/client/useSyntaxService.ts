import { useEffect, useState } from "react";
import { SyntaxService } from "./syntaxService";

export function useSyntaxService(): SyntaxService {
  // Construction is resource-free; dispose resets the service for StrictMode effect replay.
  const [service] = useState(() => new SyntaxService());
  useEffect(() => () => service.dispose(), [service]);
  return service;
}
