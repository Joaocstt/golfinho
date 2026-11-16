import { expect, it } from "vitest";
import { Grammar, monacoToken } from "../src/renderer/textmate";

// A gramática do http-client do ORCA, como vem no plugin.
const http = new Grammar({
  patterns: [{ include: "#comment" }, { include: "#request-line" }, { include: "#header" }, { include: "#variable" }, { include: "#separator" }],
  repository: {
    comment: { match: "^#.*$", name: "comment.line.number-sign.http" },
    separator: { match: "^###.*$", name: "keyword.control.separator.http" },
    "request-line": {
      match: "^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\\s+(\\S+)\\s*(HTTP/[0-9.]+)?$",
      captures: { 1: { name: "keyword.operator.http.method" }, 2: { name: "string.other.http.url" }, 3: { name: "constant.language.http.version" } },
    },
    header: { match: "^([\\w-]+):\\s*(.*)$", captures: { 1: { name: "entity.name.tag.http.header" }, 2: { name: "string.http.header.value" } } },
    variable: { match: "\\{\\{([\\w.]+)\\}\\}", captures: { 1: { name: "variable.other.http" } } },
  },
});
const scopes = (line: string) => http.tokenize(line, []).tokens.map((t) => [line.slice(t.startIndex), t.scope]);

it("colore linha de requisição, cabeçalho e variável", () => {
  expect(scopes("GET https://x/y HTTP/1.1")).toEqual([
    ["GET https://x/y HTTP/1.1", "keyword.operator.http.method"],
    [" https://x/y HTTP/1.1", ""],
    ["https://x/y HTTP/1.1", "string.other.http.url"],
    [" HTTP/1.1", ""],
    ["HTTP/1.1", "constant.language.http.version"],
  ]);
  expect(scopes("Accept: application/json").map((s) => s[1])).toEqual(["entity.name.tag.http.header", "", "string.http.header.value"]);
  expect(scopes("# nota")).toEqual([["# nota", "comment.line.number-sign.http"]]);
  expect(scopes('{ "a": "{{token}}" }').map((s) => s[1])).toContain("variable.other.http");
});

it("blocos begin/end atravessam linhas", () => {
  const g = new Grammar({ patterns: [{ begin: "/\\*", end: "\\*/", name: "comment.block" }, { match: "\\d+", name: "constant.numeric" }] });
  const first = g.tokenize("1 /* começa", []);
  expect(first.stack).toHaveLength(1);
  const second = g.tokenize("ainda */ 2", first.stack);
  expect(second.stack).toHaveLength(0);
  expect(second.tokens.map((t) => t.scope)).toEqual(["comment.block", "", "constant.numeric"]);
});

it("nomes do TextMate viram tokens que o tema do Monaco conhece", () => {
  expect(monacoToken("entity.name.tag.http.header")).toBe("tag");
  expect(monacoToken("keyword.operator.http.method")).toBe("keyword");
  expect(monacoToken("string.other.http.url")).toBe("string.other.http.url");
});
