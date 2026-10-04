const TOKEN_KEY = "gitudium.access-token";

export function loadAccessToken(location: Pick<Location, "hash" | "pathname" | "search">, storage: Pick<Storage, "getItem" | "setItem">, replace: (url: string) => void): string | null {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const supplied = fragment.get("token");
  if (supplied !== null) {
    fragment.delete("token");
    replace(location.pathname + location.search + (fragment.size ? "#" + fragment.toString() : ""));
    if (!/^[a-f0-9]{64}$/.test(supplied)) return null;
    try { storage.setItem(TOKEN_KEY, supplied); } catch { /* Memory-only access still works if storage is blocked. */ }
    return supplied;
  }
  try {
    const stored = storage.getItem(TOKEN_KEY);
    return stored && /^[a-f0-9]{64}$/.test(stored) ? stored : null;
  } catch { return null; }
}

export function connectEvents(token: string, invalidate: () => void, status: (value: "connected" | "disconnected") => void) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try {
      const response = await fetch("/api/events", { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal, cache: "no-store" });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("Live connection unavailable");
      status("connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!abort.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 64 * 1024) throw new Error("Event size limit exceeded");
          let end: number;
          while ((end = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (event.split("\n").some(line => line === "event: invalidation")) invalidate();
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch { /* Connection state and reconnect handle transport failures. */ }
    if (!abort.signal.aborted) {
      status("disconnected");
      timer = setTimeout(() => void run(), 3000);
    }
  };
  void run();
  return () => { abort.abort(); if (timer) clearTimeout(timer); };
}
