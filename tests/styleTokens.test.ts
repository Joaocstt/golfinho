import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Um token usado sem definição vira "nada" no navegador: fundo transparente, texto sem cor.
// Só --sidebar-width é definido pelo React, direto no elemento.
it("todo token de cor e tamanho usado na interface está definido no CSS", () => {
  const dir = join(__dirname, "..", "src", "renderer");
  const css = readFileSync(join(dir, "style.css"), "utf8");
  const sources = [css, ...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(join(dir, f), "utf8"))];
  const used = new Set(sources.flatMap((s) => [...s.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
  const runtime = new Set(["--sidebar-width"]);
  expect([...used].filter((name) => !defined.has(name) && !runtime.has(name))).toEqual([]);
});
