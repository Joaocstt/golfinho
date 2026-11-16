// Leitor de gramáticas TextMate (.tmLanguage.json) para colorir o editor de código com a
// gramática de um plugin. Cobre o que gramáticas simples usam: match com captures, begin/end
// com patterns, include (#regra e $self). As expressões são do JavaScript: uma regra com
// recurso só do Oniguruma (o motor do VS Code) é deixada de fora, e o resto continua valendo.

interface Raw {
  match?: string;
  begin?: string;
  end?: string;
  name?: string;
  contentName?: string;
  captures?: Record<string, { name?: string }>;
  beginCaptures?: Record<string, { name?: string }>;
  endCaptures?: Record<string, { name?: string }>;
  patterns?: Raw[];
  include?: string;
  repository?: Record<string, Raw>;
}

interface Rule {
  regex: RegExp;
  name?: string;
  captures?: Record<string, { name?: string }>;
  // Regras com begin/end abrem um bloco até o end.
  block?: { end: string; endCaptures?: Record<string, { name?: string }>; contentName?: string; patterns: () => Rule[] };
}

export interface Token {
  startIndex: number;
  scope: string;
}

export interface Frame {
  rule: Rule;
  end: RegExp;
}

function compile(source: string): RegExp | null {
  let flags = "dg";
  let src = source;
  if (src.startsWith("(?i)")) {
    flags += "i";
    src = src.slice(4);
  }
  // \h e \H do Oniguruma (dígito hexadecimal) têm equivalente direto.
  src = src.replace(/\\h/g, "[0-9a-fA-F]").replace(/\\H/g, "[^0-9a-fA-F]").replace(/\\A/g, "^").replace(/\\Z|\\z/g, "$");
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

export class Grammar {
  readonly root: () => Rule[];
  constructor(raw: Raw) {
    const repository = raw.repository ?? {};
    const cache = new Map<Raw, Rule[]>();
    const build = (list: Raw[] = [], seen = new Set<Raw>()): Rule[] => {
      const rules: Rule[] = [];
      for (const item of list) {
        if (item.include) {
          const target = item.include === "$self" || item.include === "$base" ? raw : repository[item.include.replace(/^#/, "")];
          if (target && !seen.has(target)) rules.push(...expand(target, new Set([...seen, target])));
          continue;
        }
        rules.push(...expand(item, seen));
      }
      return rules;
    };
    const expand = (item: Raw, seen: Set<Raw>): Rule[] => {
      if (item === raw) return build(raw.patterns, seen);
      if (!item.match && !item.begin) return build(item.patterns, seen);
      const cached = cache.get(item);
      if (cached) return cached;
      const regex = compile(item.match ?? item.begin!);
      const end = item.end;
      const rules: Rule[] = [];
      if (regex)
        rules.push({
          regex,
          name: item.name,
          captures: item.match ? item.captures : (item.beginCaptures ?? item.captures),
          block: item.begin && end !== undefined
            ? { end, endCaptures: item.endCaptures ?? item.captures, contentName: item.contentName, patterns: () => build(item.patterns) }
            : undefined,
        });
      cache.set(item, rules);
      return rules;
    };
    this.root = () => build(raw.patterns);
  }

  // Uma linha: devolve os pedaços com o escopo mais de dentro e os blocos ainda abertos.
  tokenize(line: string, stack: Frame[]): { tokens: Token[]; stack: Frame[] } {
    const frames = [...stack];
    const marks: { at: number; scope: string }[] = [];
    const scopeOf = (frame?: Frame) => (frame ? (frame.rule.block?.contentName ?? frame.rule.name ?? "") : "");
    const mark = (at: number, scope: string) => marks.push({ at, scope });
    const paint = (match: RegExpExecArray, base: string, captures?: Record<string, { name?: string }>, after?: string) => {
      const start = match.index;
      const stop = start + match[0].length;
      mark(start, base);
      const indices = (match as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices ?? [];
      for (let i = 1; i < indices.length; i++) {
        const range = indices[i];
        const scope = captures?.[i]?.name;
        if (!range || !scope || range[0] === range[1]) continue;
        mark(range[0], scope);
        mark(range[1], base);
      }
      mark(stop, after ?? "");
    };
    let pos = 0;
    let guard = 0;
    mark(0, scopeOf(frames.at(-1)));
    while (pos <= line.length && guard++ < 1000) {
      const top = frames.at(-1);
      const rules = top ? top.rule.block!.patterns() : this.root();
      let best: { match: RegExpExecArray; rule?: Rule } | null = null;
      if (top) {
        top.end.lastIndex = pos;
        const m = top.end.exec(line);
        if (m) best = { match: m };
      }
      for (const rule of rules) {
        rule.regex.lastIndex = pos;
        const m = rule.regex.exec(line);
        if (m && (!best || m.index < best.match.index)) best = { match: m, rule };
      }
      if (!best) break;
      const { match, rule } = best;
      const length = match[0].length;
      if (!rule) {
        // Fim do bloco aberto.
        frames.pop();
        const outer = scopeOf(frames.at(-1));
        paint(match, top!.rule.name ?? outer, top!.rule.block!.endCaptures, outer);
      } else if (rule.block) {
        const end = compile(rule.block.end.replace(/\\(\d)/g, (_, n) => escape(match[Number(n)] ?? "")));
        if (end) {
          frames.push({ rule, end });
          paint(match, rule.name ?? scopeOf(top), rule.captures, scopeOf(frames.at(-1)));
        }
      } else paint(match, rule.name ?? scopeOf(top), rule.captures, scopeOf(top));
      pos = match.index + Math.max(length, length === 0 ? 1 : 0);
      if (length === 0 && !rule?.block) pos = match.index + 1;
    }
    // Marcas viram pedaços contínuos: a última marca num ponto vale.
    const at = new Map<number, string>();
    for (const m of marks) if (m.at <= line.length) at.set(m.at, m.scope);
    const tokens: Token[] = [];
    for (const [startIndex, scope] of [...at.entries()].sort((a, b) => a[0] - b[0]))
      if (startIndex < line.length || startIndex === 0)
        if (!tokens.length || tokens.at(-1)!.scope !== scope) tokens.push({ startIndex, scope });
    return { tokens, stack: frames };
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Escopo TextMate → nome que os temas do Monaco conhecem (que casam pelo começo do nome).
export function monacoToken(scope: string): string {
  if (!scope) return "";
  if (scope.startsWith("entity.name.tag")) return "tag";
  if (scope.startsWith("entity.name.function") || scope.startsWith("support.function")) return "function";
  if (scope.startsWith("entity.name") || scope.startsWith("support.type") || scope.startsWith("storage.type")) return "type";
  if (scope.startsWith("keyword.operator")) return "keyword";
  if (scope.startsWith("markup.heading")) return "keyword";
  return scope;
}
