import { loadAccessToken } from "./access";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../server/router";

export const token = loadAccessToken(window.location, {
  getItem: key => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
}, url => window.history.replaceState(null, "", url));
export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc", headers: () => token ? { Authorization: `Bearer ${token}` } : {} })],
});
