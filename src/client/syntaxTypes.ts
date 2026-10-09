export interface SyntaxToken {
  text: string;
  color?: string;
}

export interface SyntaxResult {
  before: SyntaxToken[][] | null;
  after: SyntaxToken[][] | null;
}

export interface SyntaxSource {
  revision: string;
  path: string;
  text: string;
}

export interface SyntaxSources {
  before: SyntaxSource | null;
  after: SyntaxSource | null;
}

export const SYNTAX_THEME = "github-dark";
export const SYNTAX_SOURCE_LIMIT = 1024 * 1024;
export const SYNTAX_TOKEN_LIMIT = 100_000;

export interface SyntaxRequest {
  id: number;
  sources: SyntaxSources;
}

export type SyntaxResponse =
  | { id: number; result: SyntaxResult }
  | { id: number; error: string };

// Revisions must identify immutable content. Paths also determine the grammar.
export function syntaxSourceKey(sources: SyntaxSources): string {
  const identity = (source: SyntaxSource | null) => source && [source.revision, source.path];
  return JSON.stringify([SYNTAX_THEME, identity(sources.before), identity(sources.after)]);
}

export function syntaxSourcesWithinLimit(sources: SyntaxSources): boolean {
  return [sources.before, sources.after].every(source => !source || (
    source.text.length <= SYNTAX_SOURCE_LIMIT &&
    new TextEncoder().encode(source.text).byteLength <= SYNTAX_SOURCE_LIMIT
  ));
}
