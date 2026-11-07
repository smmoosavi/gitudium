import { RepositoryError } from "./types";
import { isHistoryExpression, isRefExclusions, refExclusionPatterns } from "./validation";

function patternMatcher(pattern: string): (name: string) => boolean {
  const glob = new Bun.Glob(pattern);
  return name => glob.match(name) || pattern.endsWith("/*") && name.startsWith(pattern.slice(0, -1));
}

/** Selection policy only: Git resolution, peeling, and snapshots belong to the reader. */
export function parseHistorySelection(expression: string, exclude: string) {
  if (!isHistoryExpression(expression)) throw new RepositoryError("INVALID_INPUT", "Expected a history revision expression.");
  if (!isRefExclusions(exclude)) throw new RepositoryError("INVALID_INPUT", "Expected comma-separated ref exclusion patterns.");
  const exclusions = refExclusionPatterns(exclude).map(pattern => pattern.startsWith("refs/") ? pattern : `refs/heads/${pattern}`);
  const terms = (expression.trim() ? expression.split(",").map(term => term.trim()) : []).map(term => {
    const excluded = term.startsWith("!");
    const revision = excluded ? term.slice(1) : term;
    const matches = patternMatcher(revision);
    return {
      revision, excluded, wildcard: /[*?\[]/.test(revision),
      matchesReference: (name: string) => matches(name) || matches(name.replace(/^refs\/(?:heads|remotes|tags)\//, "")),
    };
  });
  const excludedRefs = exclusions.map(patternMatcher);
  const explicit = terms.filter(term => !term.excluded && term.revision !== "all");
  return {
    terms,
    exclusions,
    implicitAll: !terms.some(term => !term.excluded),
    // Reachability selection does not hide other labels unless a saved exclusion applies.
    includesDecoration: (name: string) => !excludedRefs.some(matches => matches(name))
      || explicit.some(term => term.matchesReference(name)),
  };
}

export type HistorySelection = ReturnType<typeof parseHistorySelection>;
