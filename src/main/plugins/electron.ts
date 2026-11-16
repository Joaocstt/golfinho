import { app, dialog, ipcMain, protocol, utilityProcess, type BrowserWindow } from "electron";
import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { Vault } from "../vault";
import type { Store } from "../store";
import { PluginManager, type Channel, type Workspace } from "./manager";
import { FRAME_SCRIPT, PANEL_MAIN, PANEL_RUNTIME, editorPage, linkOrca, panelPage } from "./frame";
import { SOURCE, resolveFile, toJs } from "./transpile";

// Liga os plugins ao Electron: o processo de cada worker, a janela de pedidos (IPC) e o esquema
// golfinho-plugin://, que serve os arquivos do plugin para o iframe do editor dele.

export const PLUGIN_SCHEME = "golfinho-plugin";
export const pluginSchemePrivileges = {
  scheme: PLUGIN_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
};

const key = z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("pick"), kind: z.enum(["folder", "zip"]), dev: z.boolean().optional() }),
  z.object({ action: z.literal("prepare"), kind: z.enum(["folder", "zip", "git"]), location: z.string().min(1).max(2000), dev: z.boolean().optional() }),
  z.object({ action: z.literal("install"), token: z.string().uuid() }),
  z.object({ action: z.literal("discard"), token: z.string().uuid() }),
  z.object({ action: z.literal("remove"), key }),
  z.object({ action: z.literal("enable"), key, enabled: z.boolean() }),
  z.object({ action: z.literal("reload"), key }),
  z.object({ action: z.literal("settings"), key, values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }),
  z.object({ action: z.literal("logs"), key }),
  z.object({ action: z.literal("syntax"), key, id: z.string().max(64) }),
  z.object({ action: z.literal("template"), key, id: z.string().max(64) }),
  z.object({ action: z.literal("request"), key, id: z.number().int(), name: z.string().min(1).max(200), input: z.unknown() }),
  z.object({ action: z.literal("cancel"), id: z.number().int() }),
  z.object({ action: z.literal("focus"), projectId: z.string(), taskId: z.string() }),
]);
export type PluginRequest = z.infer<typeof requestSchema>;

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// Arquivo de dentro do plugin, sem sair da pasta e sem passar de 1 MB.
async function readPluginFile(dir: string, path: string): Promise<string> {
  const root = resolve(dir) + sep;
  const file = resolve(root, path);
  if (!file.startsWith(root)) throw new Error("Caminho fora do plugin.");
  const text = await readFile(file, "utf8");
  if (text.length > 1024 * 1024) throw new Error(`${basename(file)} passa de 1 MB.`);
  return text;
}

export function setupPlugins(options: {
  here: string;
  root: string;
  vault: Vault;
  store: () => Store;
  window: () => BrowserWindow | null;
  activeBranch: (projectId: string) => string | null;
  notify: (title: string, body: string) => void;
}) {
  const logs = new Map<string, string[]>();
  const log = (k: string, text: string) => {
    const list = logs.get(k) ?? [];
    list.push(`${new Date().toLocaleTimeString()} ${text}`);
    logs.set(k, list.slice(-200));
  };
  let focus = { projectId: "", taskId: "" };
  const send = (channel: string, payload: unknown) => {
    const w = options.window();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  const manager = new PluginManager({
    root: options.root,
    vault: options.vault,
    spawn(k): Channel {
      const child = utilityProcess.fork(join(options.here, "pluginHost.js"), [], { serviceName: `Plugin ${k}`, stdio: "pipe" });
      child.stdout?.on("data", (d) => log(k, String(d).trimEnd()));
      child.stderr?.on("data", (d) => log(k, String(d).trimEnd()));
      return {
        postMessage: (m) => child.postMessage(m),
        onMessage: (l) => child.on("message", l),
        onExit: (l) => child.on("exit", l),
        kill: () => child.kill(),
      };
    },
    // Projetos do Golfinho e as pastas das tarefas que têm worktree própria.
    workspaces() {
      const store = options.store();
      const list: Workspace[] = store.projects().map((p) => ({ name: p.name, path: p.path, branch: options.activeBranch(p.id) }));
      for (const t of store.tasks())
        if (t.worktreePath) list.push({ name: store.projects().find((p) => p.id === t.projectId)?.name ?? t.title, path: t.worktreePath, branch: t.branch || null });
      return list;
    },
    // A tarefa aberta agora, no formato do ORCA (nome do workspace e branch).
    context() {
      const store = options.store();
      try {
        const task = focus.taskId ? store.task(focus.taskId) : null;
        const project = store.project(task?.projectId ?? focus.projectId);
        return { displayName: project.name, branch: task?.branch ?? options.activeBranch(project.id) ?? "", terminals: [] };
      } catch {
        return null;
      }
    },
    notify: options.notify,
    post: (k, event, data) => send("golfinho:plugin-event", { key: k, event, data }),
    log,
  });

  const ready = manager.load().then(() => manager.loadSettings());
  const controllers = new Map<number, AbortController>();

  ipcMain.handle("golfinho:plugins", async (event, input: unknown) => {
    const w = options.window();
    if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame)
      return { ok: false, error: "Origem de mensagem não autorizada." };
    try {
      await ready;
      const r = requestSchema.parse(input);
      return { ok: true, value: await handle(r, w) };
    } catch (error) {
      const e = error as Error & { code?: string };
      return { ok: false, error: e.message, code: e.code };
    }
  });

  async function handle(r: PluginRequest, w: BrowserWindow): Promise<unknown> {
    switch (r.action) {
      case "list":
        return manager.list();
      case "pick": {
        const picked = await dialog.showOpenDialog(w, {
          title: r.kind === "zip" ? "Escolher o .zip do plugin" : "Escolher a pasta do plugin",
          properties: r.kind === "zip" ? ["openFile"] : ["openDirectory"],
          filters: r.kind === "zip" ? [{ name: "Plugin (.zip)", extensions: ["zip"] }] : undefined,
        });
        if (picked.canceled || !picked.filePaths[0]) return null;
        return manager.prepare({ kind: r.kind, location: picked.filePaths[0], dev: r.dev });
      }
      case "prepare":
        return manager.prepare({ kind: r.kind, location: r.location, dev: r.dev });
      case "install":
        return manager.install(r.token);
      case "discard":
        return manager.discard(r.token);
      case "remove":
        return manager.remove(r.key);
      case "enable":
        return manager.setEnabled(r.key, r.enabled);
      case "reload":
        return manager.reload(r.key);
      case "settings":
        return manager.setSettings(r.key, r.values);
      case "logs":
        return logs.get(r.key) ?? [];
      // Gramática TextMate (e a configuração da linguagem) para o editor de código.
      case "syntax": {
        const p = manager.plugin(r.key);
        const s = manager.manifest(r.key).syntaxes.find((x) => x.id === r.id);
        if (!p.enabled || !s) throw new Error("Gramática não encontrada.");
        const json = async (path?: string) => (path ? JSON.parse(await readPluginFile(p.path, path)) : null);
        return { grammar: await json(s.path), configuration: await json(s.configuration).catch(() => null) };
      }
      case "template": {
        const p = manager.plugin(r.key);
        const f = manager.manifest(r.key).newFiles.find((x) => x.id === r.id);
        if (!p.enabled || !f) throw new Error("Modelo de arquivo não encontrado.");
        return f.template ? readPluginFile(p.path, f.template) : "";
      }
      case "request": {
        const controller = new AbortController();
        controllers.set(r.id, controller);
        try {
          return await manager.request(r.key, r.name, r.input, controller.signal);
        } finally {
          controllers.delete(r.id);
        }
      }
      case "cancel":
        controllers.get(r.id)?.abort();
        return null;
      case "focus":
        focus = { projectId: r.projectId, taskId: r.taskId };
        return null;
    }
  }

  // golfinho-plugin://<publisher>.<id>/<caminho>: só arquivos de dentro do plugin, de plugin ativo.
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url);
    const plugin = manager.list().find((p) => p.key === url.hostname && p.enabled);
    const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (!plugin) return new Response("Plugin não encontrado.", { status: 404, headers });
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const js = { ...headers, "Content-Type": "text/javascript; charset=utf-8" };
    if (path === "__golfinho/frame.js") return new Response(FRAME_SCRIPT, { headers: js });
    if (path === "__golfinho/orca.js") return new Response(PANEL_RUNTIME, { headers: js });
    if (path === "__golfinho/panel-main.js") return new Response(PANEL_MAIN, { headers: js });
    const panel = /^__golfinho\/panel\/([a-z0-9-]+)\.html$/i.exec(path);
    if (panel) {
      const m = manager.manifest(plugin.key).panels.find((x) => x.id === panel[1] && x.ui === "components");
      if (!m) return new Response("Painel não encontrado.", { status: 404, headers });
      return new Response(panelPage(plugin.key, m.entry), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    }
    const editor = /^__golfinho\/editor\/([a-z0-9-]+)\.html$/i.exec(path);
    if (editor) {
      const e = plugin.editors.find((x) => x.id === editor[1]);
      const m = manager.manifest(plugin.key).customEditors.find((x) => x.id === editor[1]);
      if (!e || !m) return new Response("Editor não encontrado.", { status: 404, headers });
      return new Response(editorPage(plugin.key, m.entry, url.searchParams.get("theme") !== "light"), {
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const root = resolve(plugin.path) + sep;
    const file = resolveFile(resolve(root, path));
    if (!file || !file.startsWith(root) || file.split(sep).includes("node_modules"))
      return new Response("Arquivo não encontrado.", { status: 404, headers });
    try {
      if (SOURCE.test(file))
        return new Response(linkOrca(toJs(await readFile(file, "utf8"), file), plugin.key), { headers: js });
      return new Response(await readFile(file), {
        headers: { ...headers, "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" },
      });
    } catch (error) {
      return new Response(`Não foi possível ler ${basename(file)}: ${(error as Error).message}`, { status: 500, headers });
    }
  });

  app.on("will-quit", () => manager.stopAll());
  return manager;
}
