// O que roda dentro do iframe do editor de um plugin, antes do código dele: o objeto `orca`
// do ORCA (documento aberto e conversa com o worker), falando com o Golfinho por postMessage.
// O iframe é isolado (sandbox sem allow-same-origin): não vê o Golfinho nem os arquivos.

export const FRAME_SCRIPT = `(() => {
  const parent = window.parent;
  let next = 0;
  const waiting = new Map();
  const listeners = new Map();
  let replace = [];
  const ask = (type, payload) => new Promise((done, fail) => {
    const id = ++next;
    waiting.set(id, { done, fail });
    parent.postMessage({ golfinho: true, id, type, ...payload }, "*");
    return id;
  });
  window.addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || !m.golfinho) return;
    if (m.type === "reply") {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (!w) return;
      if (m.ok) w.done(m.value);
      else w.fail(Object.assign(new Error(m.error?.message || "Erro"), { code: m.error?.code }));
    } else if (m.type === "event") {
      for (const l of listeners.get(m.event) || []) try { l(m.data); } catch (err) { console.error(err); }
    } else if (m.type === "replace") {
      for (const l of replace) try { l(m.value); } catch (err) { console.error(err); }
    } else if (m.type === "theme") {
      document.documentElement.classList.toggle("dark", m.dark);
      document.documentElement.classList.toggle("light", !m.dark);
    }
  });
  const request = (name, input, options = {}) => {
    const id = next + 1;
    const promise = ask("request", { name, input, timeoutMs: options.timeoutMs });
    if (options.signal) {
      if (options.signal.aborted) parent.postMessage({ golfinho: true, type: "cancel", target: id }, "*");
      else options.signal.addEventListener("abort", () => parent.postMessage({ golfinho: true, type: "cancel", target: id }, "*"), { once: true });
    }
    return promise;
  };
  const on = (event, listener) => {
    const set = listeners.get(event) || new Set();
    set.add(listener);
    listeners.set(event, set);
    return { dispose: () => set.delete(listener) };
  };
  const document_ = {
    async session() {
      const s = await ask("session", {});
      return {
        value: s.value,
        readOnly: s.readOnly,
        path: s.path,
        change(value) { parent.postMessage({ golfinho: true, type: "change", value }, "*"); },
        save() { return ask("save", {}); },
        onReplace(listener) { replace.push(listener); return { dispose: () => { replace = replace.filter((x) => x !== listener); } }; },
      };
    },
  };
  const plugin = Object.freeze({ request, on });
  // Para o painel: o runtime de componentes usa a mesma conversa com o Golfinho.
  Object.defineProperty(window, "__golfinhoAsk", { value: ask });
  Object.defineProperty(window, "orca", { value: Object.freeze({ document: Object.freeze(document_), plugin }), writable: false });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void ask("save", {}); }
  });
})();
`;

// Página do editor: o script acima, as cores do Golfinho nas variáveis do ORCA e o código do plugin.
export function editorPage(key: string, entry: string, dark: boolean): string {
  const base = `golfinho-plugin://${key}`;
  const vars = dark
    ? "--orca-background:#141414;--orca-foreground:#e8e8e8;--orca-border:#2a2a2a;--orca-secondary:#202020;--orca-accent:#2c2c2c;--orca-muted-foreground:#9a9a9a;--orca-primary:#3b82f6;--orca-primary-foreground:#ffffff;--orca-radius:6px;"
    : "--orca-background:#ffffff;--orca-foreground:#1a1a1a;--orca-border:#dddddd;--orca-secondary:#f2f2f2;--orca-accent:#e6e6e6;--orca-muted-foreground:#666666;--orca-primary:#2563eb;--orca-primary-foreground:#ffffff;--orca-radius:6px;";
  return `<!doctype html>
<html class="${dark ? "dark" : "light"}" style="${vars}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${base}; style-src 'unsafe-inline' ${base}; img-src ${base} data: blob:; font-src ${base} data:; connect-src 'none'">
<script src="${base}/__golfinho/frame.js"></script>
</head>
<body>
<script type="module" src="${base}/${entry}"></script>
</body>
</html>`;
}

// Módulo "orca" dos painéis com ui: "components". O código do painel monta uma árvore com estes
// componentes; o Golfinho a desenha com o visual dele (src/renderer/PluginPanel.tsx). Funções
// (onPress, onChange...) viram números: o clique volta para cá e chama a função certa.
export const PANEL_RUNTIME = `
const COMPONENTS = ["Badge", "Box", "Button", "Callout", "Card", "CodeView", "Collapsible", "Divider", "EmptyState", "Heading",
  "IconButton", "Input", "KeyValue", "Link", "List", "ListItem", "Progress", "Row", "Select", "Spinner", "Stack", "Switch", "Tab",
  "Tabs", "Text", "TextArea", "Checkbox", "Image"];
export const Fragment = "Fragment";
export const { Badge, Box, Button, Callout, Card, CodeView, Collapsible, Divider, EmptyState, Heading, IconButton, Input, KeyValue,
  Link, List, ListItem, Progress, Row, Select, Spinner, Stack, Switch, Tab, Tabs, Text, TextArea, Checkbox, Image } =
  Object.fromEntries(COMPONENTS.map((n) => [n, n]));

export function jsx(type, props, key) {
  return typeof type === "function" ? type(props ?? {}) : { $$golfinho: true, type, props: props ?? {}, key };
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export const createElement = (type, props, ...children) => jsx(type, { ...(props ?? {}), children: children.length > 1 ? children : children[0] });

let persisted = {};
const atoms = new Map();
export function __restore(values) { persisted = values || {}; }
export function atom(a, b, c) {
  const keyed = typeof a === "string" && arguments.length >= 2;
  const key = keyed ? a : null;
  const options = keyed ? c : b;
  const initial = keyed ? b : a;
  const box = { value: key && options?.persist && key in persisted ? persisted[key] : initial, key, persist: Boolean(key && options?.persist) };
  if (key) atoms.set(key, box);
  return box;
}
export const read = (box) => box.value;
export function set(box, value) {
  box.value = typeof value === "function" ? value(box.value) : value;
  if (box.persist) window.parent.postMessage({ golfinho: true, type: "persist", key: box.key, value: box.value }, "*");
  schedule();
}
export const update = (box, fn) => set(box, fn(box.value));
export const plugin = window.orca.plugin;

let scheduled = false;
let render = () => {};
export function __onRender(fn) { render = fn; }
export function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; render(); });
}
`;

// Arranque do painel: recupera os átomos salvos, carrega o código do plugin e manda a árvore.
export const PANEL_MAIN = `
const entry = new URL(import.meta.url).searchParams.get("entry");
const base = new URL(import.meta.url).origin;
const runtime = await import(base + "/__golfinho/orca.js");
runtime.__restore(await window.__golfinhoAsk("atoms", {}));
const module = await import(base + "/" + entry);
const View = module.default ?? module.Panel;
let callbacks = new Map();
const post = (m) => window.parent.postMessage({ golfinho: true, ...m }, "*");
function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(serialize).flat().filter((x) => x !== null);
  if (!node.$$golfinho) return String(node);
  const props = {};
  for (const [k, v] of Object.entries(node.props)) {
    if (k === "children") continue;
    if (typeof v === "function") { const id = callbacks.size + 1; callbacks.set(id, v); props[k] = { $fn: id }; }
    else props[k] = v;
  }
  let children = serialize(node.props.children);
  if (children !== null && !Array.isArray(children)) children = [children];
  return { type: node.type, props, children: children ?? [] };
}
function draw() {
  callbacks = new Map();
  try { post({ type: "tree", tree: serialize(View()) }); }
  catch (error) { post({ type: "failed", message: String(error?.message ?? error) }); }
}
runtime.__onRender(draw);
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !e.data?.golfinho || e.data.type !== "invoke") return;
  const fn = callbacks.get(e.data.fn);
  if (!fn) return;
  Promise.resolve()
    .then(() => fn(...(e.data.args ?? [])))
    .catch((error) => post({ type: "failed", message: String(error?.message ?? error) }))
    .finally(() => runtime.schedule());
  runtime.schedule();
});
const ctx = { subscriptions: [] };
try { await module.setup?.(ctx); } catch (error) { post({ type: "failed", message: String(error?.message ?? error) }); }
draw();
`;

export function panelPage(key: string, entry: string): string {
  const base = `golfinho-plugin://${key}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${base}; connect-src 'none'">
<script src="${base}/__golfinho/frame.js"></script>
</head>
<body>
<script type="module" src="${base}/__golfinho/panel-main.js?entry=${encodeURIComponent(entry)}"></script>
</body>
</html>`;
}

// O painel importa de "orca" (e o JSX, de "orca/jsx-runtime"): no navegador, isso aponta para o
// runtime acima. O resto do código do plugin não muda.
export function linkOrca(code: string, key: string): string {
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])orca(?:\/jsx-runtime|\/jsx-dev-runtime)?\2/g, `$1"golfinho-plugin://${key}/__golfinho/orca.js"`);
}
