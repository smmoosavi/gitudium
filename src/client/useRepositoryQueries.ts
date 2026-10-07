import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HistoryCursor } from "../repository/types";
import { HISTORY_CHUNK_SIZE } from "../repository/limits";
import { nextHistoryCursor } from "./history";
import { api } from "./api";

export function useRepositoryQueries(revision: string) {
  const metadata = useQuery({ queryKey: ["metadata"], queryFn: ({ signal }) => api.metadata.query(undefined, { signal }), retry: false });
  const references = useQuery({ queryKey: ["references"], enabled: metadata.isSuccess, queryFn: ({ signal }) => api.references.query(undefined, { signal }), retry: false });
  const history = useInfiniteQuery({
    queryKey: ["history", revision], enabled: metadata.isSuccess && references.isSuccess, initialPageParam: undefined as HistoryCursor | undefined,
    queryFn: ({ pageParam, signal }) => api.history.query({ revision: pageParam ? undefined : revision || undefined, limit: HISTORY_CHUNK_SIZE, cursor: pageParam }, { signal }),
    getNextPageParam: nextHistoryCursor, retry: false,
  });
  const commits = useMemo(() => history.data?.pages.flatMap(page => page.commits) ?? [], [history.data]);
  const loadMoreHistory = useCallback(() => { void history.fetchNextPage(); }, [history.fetchNextPage]);
  return { metadata, references, history, commits, loadMoreHistory };
}
