import * as monaco from "monaco-editor";
import { Grammar, monacoToken, type Frame } from "./textmate";
import { pluginRequest, type PluginInfo } from "./plugins";

// Linguagens que os plugins trazem (syntaxes do ORCA) registradas no Monaco, uma vez cada.
// A cor vem da gramática TextMate do plugin; comentário, parênteses e aspas, da configuração.

const registered = new Map<string, Promise<void>>();

class State implements monaco.languages.IState {
  constructor(readonly stack: Frame[]) {}
  clone() {
    return new State([...this.stack]);
  }
  equals(other: monaco.languages.IState) {
    const o = other as State;
    return o.stack.length === this.stack.length && o.stack.every((f, i) => f.rule === this.stack[i].rule && f.end.source === this.stack[i].end.source);
  }
}

export function registerPluginSyntaxes(plugins: PluginInfo[]): Promise<void> {
  const work: Promise<void>[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const syntax of plugin.syntaxes) {
      const key = `${plugin.key}:${syntax.id}`;
      let job = registered.get(key);
      if (!job) {
        // O id da gramática ("http") vira a linguagem, se o Monaco ainda não tiver uma com ele.
        const taken = monaco.languages.getLanguages().some((l) => l.id === syntax.id);
        const id = taken ? `${plugin.key}.${syntax.id}` : syntax.id;
        job = pluginRequest<{ grammar: unknown; configuration: Record<string, unknown> | null }>({ action: "syntax", key: plugin.key, id: syntax.id })
          .then(({ grammar, configuration }) => {
            monaco.languages.register({ id, extensions: syntax.extensions, filenames: syntax.filenames, aliases: [syntax.title] });
            const g = new Grammar(grammar as ConstructorParameters<typeof Grammar>[0]);
            monaco.languages.setTokensProvider(id, {
              getInitialState: () => new State([]),
              tokenize(line, state) {
                const { tokens, stack } = g.tokenize(line, (state as State).stack);
                return { tokens: tokens.map((t) => ({ startIndex: t.startIndex, scopes: monacoToken(t.scope) })), endState: new State(stack) };
              },
            });
            if (configuration) monaco.languages.setLanguageConfiguration(id, languageConfiguration(configuration));
          })
          .catch((error) => console.error(`Gramática ${syntax.title} do plugin ${plugin.name}:`, error));
        registered.set(key, job);
      }
      work.push(job);
    }
  }
  return Promise.all(work).then(() => undefined);
}

type Pair = string[] | { open: string; close: string };
function languageConfiguration(c: Record<string, unknown>): monaco.languages.LanguageConfiguration {
  const comments = c.comments as { lineComment?: string; blockComment?: [string, string] } | undefined;
  const pairs = (v: unknown) =>
    Array.isArray(v) ? (v as Pair[]).map((p) => (Array.isArray(p) ? { open: p[0], close: p[1] } : { open: p.open, close: p.close })) : undefined;
  return {
    comments: comments ? { lineComment: comments.lineComment, blockComment: comments.blockComment } : undefined,
    brackets: Array.isArray(c.brackets) ? (c.brackets as [string, string][]) : undefined,
    autoClosingPairs: pairs(c.autoClosingPairs),
    surroundingPairs: pairs(c.surroundingPairs),
  };
}
