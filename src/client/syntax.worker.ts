import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { bundledLanguages } from "shiki/langs";
import type { BundledLanguage } from "shiki/langs";
import {
  SYNTAX_THEME, SYNTAX_TOKEN_LIMIT, syntaxSourcesWithinLimit,
} from "./syntaxTypes";
import type { SyntaxRequest, SyntaxResponse, SyntaxResult, SyntaxSources, SyntaxToken } from "./syntaxTypes";

export interface SyntaxTokenizer {
  tokenize(text: string, path: string): Promise<SyntaxToken[][]>;
}

const extensions: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  py: "python", rb: "ruby", rs: "rust", sh: "shellscript", bash: "shellscript",
  yml: "yaml", md: "markdown", mdx: "mdx", h: "c", cc: "cpp", hpp: "cpp",
  cs: "csharp", fs: "fsharp", vue: "vue", svelte: "svelte", html: "html",
  css: "css", scss: "scss", json: "json", jsonc: "jsonc", toml: "toml",
  xml: "xml", sql: "sql", go: "go", java: "java", kt: "kotlin", php: "php",
};

function languageForPath(path: string): BundledLanguage | undefined {
  const name = path.split(/[\\/]/).at(-1)!.toLowerCase();
  const extension = name.includes(".") ? name.split(".").at(-1)! : "";
  const language = name === "dockerfile" ? "dockerfile"
    : name === "makefile" ? "make" : extensions[extension] ?? extension;
  return Object.hasOwn(bundledLanguages, language) ? language as BundledLanguage : undefined;
}

export function createSyntaxTokenizer(): SyntaxTokenizer {
  let highlighter: ReturnType<typeof createHighlighterCore> | undefined;
  return {
    async tokenize(text, path) {
      const language = languageForPath(path);
      if (!language) return text.split(/\r\n|\n|\r/).map(line => [{ text: line }]);
      highlighter ??= createHighlighterCore({
        themes: [() => import("shiki/themes/github-dark.mjs")],
        langs: [],
        engine: createOnigurumaEngine(() => import("shiki/wasm")),
      });
      const instance = await highlighter;
      if (!instance.getLoadedLanguages().includes(language)) {
        await instance.loadLanguage(bundledLanguages[language]);
      }
      return instance.codeToTokensBase(text, { lang: language, theme: SYNTAX_THEME })
        .map(line => line.map(token => ({ text: token.content, color: token.color })));
    },
  };
}

// The scheduler depends only on the plain-token protocol, not a highlighting library.
export async function tokenizeSyntaxSources(
  sources: SyntaxSources, tokenizer: SyntaxTokenizer,
): Promise<SyntaxResult> {
  if (!syntaxSourcesWithinLimit(sources)) throw new Error("Syntax source budget exceeded");
  let count = 0;
  const side = async (source: SyntaxSources["before"]) => {
    if (!source) return null;
    const lines = await tokenizer.tokenize(source.text, source.path);
    for (const line of lines) {
      count += line.length;
      if (count > SYNTAX_TOKEN_LIMIT) throw new Error("Syntax token budget exceeded");
    }
    return lines;
  };
  const before = await side(sources.before);
  const after = await side(sources.after);
  return { before, after };
}

const scope = globalThis as unknown as {
  document?: unknown;
  postMessage?: (response: SyntaxResponse) => void;
  onmessage: ((event: MessageEvent<SyntaxRequest>) => void) | null;
};
if (typeof scope.document === "undefined" && typeof scope.postMessage === "function") {
  const tokenizer = createSyntaxTokenizer();
  scope.onmessage = async ({ data }) => {
    try {
      const result = await tokenizeSyntaxSources(data.sources, tokenizer);
      scope.postMessage!({ id: data.id, result });
    } catch {
      scope.postMessage!({ id: data.id, error: "Syntax highlighting failed" });
    }
  };
}
