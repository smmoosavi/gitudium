export function sameFileDiffPlaceholder<T>(previousData: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined, revision: string, path: string | null): T | undefined {
  return previousQuery?.queryKey[1] === revision && previousQuery.queryKey[2] === path ? previousData : undefined;
}
