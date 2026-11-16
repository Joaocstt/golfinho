// Processo do worker de um plugin (utilityProcess do Electron), um por plugin. Carrega o `main`
// do manifesto e entrega a ele o objeto `orca`, a única porta para o Golfinho: guardar dados,
// segredos, configurações, consultar o app e responder ao editor e ao painel do plugin.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SOURCE, resolveFile, toJs } from "./transpile";

type Message =
  | { type: "start"; dir: string; main: string }
  | { type: "request"; id: number; name: string; input: unknown }
  | { type: "cancel"; id: number }
  | { type: "result"; id: number; ok: boolean; value?: unknown; error?: { code?: string; message: string } };

interface Port {
  postMessage(message: unknown): void;
  on(event: "message", listener: (e: { data: Message }) => void): void;
}
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (message: unknown) => port.postMessage(message);

let calls = 0;
const waiting = new Map<number, { done: (v: unknown) => void; fail: (e: Error) => void }>();
// Toda chamada ao Golfinho passa por aqui; quem decide se é permitida é o processo principal.
function call(method: string, args?: unknown): Promise<any> {
  const id = ++calls;
  send({ type: "call", id, method, args });
  return new Promise((done, fail) => waiting.set(id, { done, fail }));
}

const handlers = new Map<string, (input: unknown, ctx: { signal: AbortSignal }) => unknown>();
const running = new Map<number, AbortController>();
const listeners = new Map<string, Set<(data: unknown) => void>>();
const subscription = (dispose: () => void) => ({ dispose });

const orca = Object.freeze({
  storage: Object.freeze({
    get: (key: string) => call("storage.get", { key }),
    set: (key: string, value: unknown) => call("storage.set", { key, value }),
    delete: (key: string) => call("storage.delete", { key }),
    keys: () => call("storage.keys"),
  }),
  secrets: Object.freeze({
    get: (key: string) => call("secrets.get", { key }),
    set: (key: string, value: string) => call("secrets.set", { key, value }),
    delete: (key: string) => call("secrets.delete", { key }),
  }),
  settings: Object.freeze({ get: () => call("settings.get") }),
  host: Object.freeze({ call: (name: string, args?: unknown) => call("host.call", { name, args }) }),
  notifications: Object.freeze({ show: (args: unknown) => call("host.call", { name: "notifications.show", args }) }),
  panels: Object.freeze({
    handle(name: string, handler: (input: unknown, ctx: { signal: AbortSignal }) => unknown) {
      handlers.set(name, handler);
      return subscription(() => handlers.delete(name));
    },
    post: (event: string, data: unknown) => send({ type: "post", event, data }),
  }),
  commands: Object.freeze({
    register(id: string, handler: (input: unknown, ctx: { signal: AbortSignal }) => unknown) {
      handlers.set(`command:${id}`, handler);
      return subscription(() => handlers.delete(`command:${id}`));
    },
  }),
  events: Object.freeze({
    on(event: string, listener: (data: unknown) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return subscription(() => set.delete(listener));
    },
  }),
  hooks: Object.freeze({ on: () => subscription(() => {}) }),
  log: (...args: unknown[]) => send({ type: "log", text: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") }),
});

async function start(dir: string, main: string) {
  const root = resolvePath(dir) + sep;
  // Só o código de dentro da pasta do plugin passa pelo TypeScript e pela busca de extensão.
  registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith("file:") && (specifier.startsWith("./") || specifier.startsWith("../"))) {
        const parent = fileURLToPath(context.parentURL);
        if (parent.startsWith(root)) {
          const file = resolveFile(resolvePath(dirname(parent), specifier));
          if (file) return { url: pathToFileURL(file).href, shortCircuit: true, format: SOURCE.test(file) ? "module" : undefined };
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith("file:") && SOURCE.test(url)) {
        const file = fileURLToPath(url);
        if (file.startsWith(root)) return { format: "module", source: toJs(readFileSync(file, "utf8"), file), shortCircuit: true };
      }
      return next(url, context);
    },
  });
  const entry = resolveFile(resolvePath(dir, main));
  if (!entry || !entry.startsWith(root)) throw new Error(`Não achei o main do plugin (${main}).`);
  const module = await import(pathToFileURL(entry).href);
  const activate = module.default ?? module.activate;
  if (typeof activate === "function") await activate(orca);
}

function fail(error: unknown) {
  const e = error as { code?: string; message?: string; name?: string };
  return { code: e?.name === "AbortError" ? "cancelled" : (e?.code ?? "error"), message: e?.message ?? String(error) };
}

port.on("message", async ({ data }) => {
  if (data.type === "start") {
    try {
      await start(data.dir, data.main);
      send({ type: "ready" });
    } catch (error) {
      send({ type: "failed", error: fail(error) });
    }
  } else if (data.type === "result") {
    const call = waiting.get(data.id);
    waiting.delete(data.id);
    if (!call) return;
    if (data.ok) call.done(data.value);
    else call.fail(Object.assign(new Error(data.error?.message ?? "Erro"), { code: data.error?.code }));
  } else if (data.type === "cancel") running.get(data.id)?.abort();
  else if (data.type === "request") {
    const handler = handlers.get(data.name);
    if (!handler) {
      send({ type: "response", id: data.id, ok: false, error: { code: "not-found", message: `O plugin não responde a "${data.name}".` } });
      return;
    }
    const controller = new AbortController();
    running.set(data.id, controller);
    try {
      const value = await handler(data.input, { signal: controller.signal });
      send({ type: "response", id: data.id, ok: true, value: value === undefined ? null : value });
    } catch (error) {
      send({ type: "response", id: data.id, ok: false, error: fail(controller.signal.aborted ? Object.assign(new Error("Cancelada"), { name: "AbortError" }) : error) });
    } finally {
      running.delete(data.id);
    }
  }
});
process.on("unhandledRejection", (error) => send({ type: "log", text: `Erro não tratado: ${fail(error).message}` }));
