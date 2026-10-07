import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectEvents } from "./access";
import { createLiveRefresh } from "./live";

export function useLiveConnection(token: string) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  useEffect(() => {
    const refresh = createLiveRefresh(queryClient);
    const close = connectEvents(token, () => { void refresh.refresh(); }, setConnection);
    return () => { close(); refresh.close(); };
  }, [queryClient, token]);
  return connection;
}
