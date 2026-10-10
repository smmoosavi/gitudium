import Parser from "web-tree-sitter";
import runtimeUrl from "web-tree-sitter/tree-sitter.wasm?url";
import javascriptUrl from "tree-sitter-wasms/out/tree-sitter-javascript.wasm?url";
import typescriptUrl from "tree-sitter-wasms/out/tree-sitter-typescript.wasm?url";
import tsxUrl from "tree-sitter-wasms/out/tree-sitter-tsx.wasm?url";
import pythonUrl from "tree-sitter-wasms/out/tree-sitter-python.wasm?url";
import jsonUrl from "tree-sitter-wasms/out/tree-sitter-json.wasm?url";
import cssUrl from "tree-sitter-wasms/out/tree-sitter-css.wasm?url";
import goUrl from "tree-sitter-wasms/out/tree-sitter-go.wasm?url";
import rustUrl from "tree-sitter-wasms/out/tree-sitter-rust.wasm?url";
import type { SyntaxSources } from "./syntaxTypes";
import type { MatchLines, MatchResult } from "./syntaxMatcher";

const urls: Record<string, string> = {
  js: javascriptUrl, jsx: javascriptUrl, mjs: javascriptUrl, cjs: javascriptUrl,
  ts: typescriptUrl, mts: typescriptUrl, cts: typescriptUrl, tsx: tsxUrl,
  py: pythonUrl, json: jsonUrl, css: cssUrl, go: goUrl, rs: rustUrl,
};
const initialized = Parser.init({ locateFile: () => runtimeUrl });
const languages = new Map<string, Promise<Parser.Language>>();

async function tokenize(source: SyntaxSources["before"]): Promise<MatchLines | null> {
  if (!source) return null;
  const url = urls[source.path.split(".").at(-1)!.toLowerCase()];
  if (!url) throw new Error("Unsupported language");
  await initialized;
  let language = languages.get(url);
  if (!language) {
    language = Parser.Language.load(url);
    languages.set(url, language);
  }
  const parser = new Parser();
  let tree;
  try {
    parser.setLanguage(await language);
    tree = parser.parse(source.text);
    if (!tree || tree.rootNode.hasError()) throw new Error("Incomplete syntax tree");
    const lines: MatchLines = source.text.split("\n").map(() => []);
    let position = 0;
    let row = 0;
    let tokens = 0;
    const append = (text: string, type: string) => {
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i) row++;
        if (parts[i]) {
          if (++tokens > 100_000) throw new Error("Syntax token limit exceeded");
          lines[row]!.push({ text: parts[i]!, type });
        }
      }
    };
    const visit = (node: Parser.SyntaxNode) => {
      if (node.childCount) {
        for (const child of node.children) visit(child);
      } else if (node.endIndex > node.startIndex) {
        append(source.text.slice(position, node.startIndex), "");
        // Parent kinds distinguish equal text used in different syntactic roles.
        append(source.text.slice(node.startIndex, node.endIndex), `${node.parent?.type ?? ""}/${node.type}`);
        position = node.endIndex;
      }
    };
    visit(tree.rootNode);
    append(source.text.slice(position), "");
    return lines;
  } finally {
    tree?.delete();
    parser.delete();
  }
}

self.onmessage = async (event: MessageEvent<SyntaxSources>) => {
  try {
    const sources = event.data;
    const result: MatchResult = { before: await tokenize(sources.before), after: await tokenize(sources.after) };
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ result: undefined, error: error instanceof Error ? error.message : String(error) });
  }
};
