import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Vault } from "../vault";
import { CAPABILITIES, MANIFEST, parseManifest, settingValues, unsupported, type Manifest } from "./manifest";
import { extractZip } from "./zip";

// Plugins instalados: cada um numa pasta própria dentro de <dados do app>/plugins, com seus dados
// (armazenamento, segredos e configurações) num arquivo à parte, e um worker só quando é usado.
// A instalação tem dois passos, como no ORCA: preparar (mostra o que o plugin pede) e aprovar.

export type PluginSource = { kind: "folder" | "zip" | "git"; location: string; dev?: boolean };

export interface InstalledPlugin {
  key: string;
  id: string;
  publisher: string;
  path: string;
  source: PluginSource;
  enabled: boolean;
  /** Permissões aprovadas na instalação. O worker só usa estas. */
  granted: string[];
  installedAt: string;
}

export interface PluginInfo extends InstalledPlugin {
  name: string;
  version: string;
  description: string;
  editors: { id: string; title: string; extensions: string[]; filenames: string[] }[];
  panels: { id: string; title: string; icon: string }[];
  syntaxes: { id: string; title: string; scopeName: string; extensions: string[]; filenames: string[] }[];
  newFiles: { id: string; title: string; extension: string }[];
  settings: Manifest["settings"];
  values: Record<string, unknown>;
  unsupported: string[];
  error?: string;
}

export interface PluginPreview {
  token: string;
  key: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  dev: boolean;
  runsCode: boolean;
  capabilities: { kind: string; text: string }[];
  unsupported: string[];
  editors: string[];
  /** Versão instalada que esta substitui, e se as permissões mudaram. */
  replaces?: { version: string; newCapabilities: string[] };
}

export interface Workspace {
  name: string;
  path: string;
  branch: string | null;
}

export interface Channel {
  postMessage(message: unknown): void;
  onMessage(listener: (message: any) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

export interface PluginDeps {
  root: string;
  vault: Vault;
  spawn(key: string): Channel;
  workspaces(): Workspace[];
  context(): { displayName: string; branch: string; terminals: { title?: string }[] } | null;
  notify(title: string, body: string): void;
  /** Evento que o worker mandou para o editor e o painel do plugin. */
  post(key: string, event: string, data: unknown): void;
  log(key: string, text: string): void;
}

interface Data {
  storage: Record<string, unknown>;
  secrets: Record<string, string>;
  settings: Record<string, unknown>;
}

interface Worker {
  channel: Channel;
  ready: Promise<void>;
  requests: Map<number, { done: (v: unknown) => void; fail: (e: Error) => void }>;
}

const run = promisify(execFile);
const SKIP = new Set(["node_modules", ".git"]);
const REQUEST_LIMIT_MS = 120_000;

// Dono do repositório (github.com/<dono>/<repo>), que vira o publisher, como no ORCA.
export function gitOwner(url: string): string {
  const match = /^(?:https?:\/\/[^/]+\/|ssh:\/\/[^/]+\/|git@[^:]+:)([^/]+)\//i.exec(url.trim());
  const owner = match?.[1]?.toLowerCase().replace(/[^a-z0-9-]/g, "") ?? "";
  if (!owner) throw new Error("Não entendi o link do Git. Use algo como https://github.com/dono/repositorio.");
  return owner;
}

export class PluginManager {
  private index: InstalledPlugin[] = [];
  private manifests = new Map<string, Manifest>();
  private errors = new Map<string, string>();
  private staged = new Map<string, { dir: string; source: PluginSource; manifest: Manifest; publisher: string; at: number }>();
  private workers = new Map<string, Worker>();
  private requests = 0;

  constructor(private deps: PluginDeps) {}

  private get indexFile() {
    return join(this.deps.root, "index.json");
  }
  private dataFile(key: string) {
    return join(this.deps.root, "data", `${key}.json`);
  }

  async load() {
    await mkdir(join(this.deps.root, "installed"), { recursive: true });
    await rm(join(this.deps.root, "staging"), { recursive: true, force: true });
    try {
      this.index = JSON.parse(await readFile(this.indexFile, "utf8"));
    } catch {
      this.index = [];
    }
    for (const p of this.index) await this.readManifest(p);
  }

  private async readManifest(p: InstalledPlugin) {
    try {
      this.manifests.set(p.key, parseManifest(await readFile(join(p.path, MANIFEST), "utf8")));
      this.errors.delete(p.key);
    } catch (error) {
      this.errors.set(p.key, (error as Error).message);
    }
  }

  private async saveIndex() {
    await writeFile(this.indexFile + ".tmp", JSON.stringify(this.index, null, 2));
    await rename(this.indexFile + ".tmp", this.indexFile);
  }

  list(): PluginInfo[] {
    return this.index.map((p) => {
      const m = this.manifests.get(p.key);
      return {
        ...p,
        name: m?.name ?? p.id,
        version: m?.version ?? "?",
        description: m?.description ?? "",
        editors: p.enabled && m ? m.customEditors.map(({ id, title, extensions, filenames }) => ({ id, title, extensions, filenames })) : [],
        panels: p.enabled && m ? m.panels.filter((x) => x.ui === "components").map(({ id, title, icon }) => ({ id, title, icon })) : [],
        syntaxes: p.enabled && m ? m.syntaxes.map(({ id, title, scopeName, extensions, filenames }) => ({ id, title, scopeName, extensions, filenames })) : [],
        newFiles: p.enabled && m ? m.newFiles.map(({ id, title, extension }) => ({ id, title, extension })) : [],
        settings: m?.settings ?? [],
        values: m ? settingValues(m, this.dataSync(p.key)?.settings ?? {}) : {},
        unsupported: m ? unsupported(m) : [],
        error: this.errors.get(p.key),
      };
    });
  }

  plugin(key: string): InstalledPlugin {
    const p = this.index.find((x) => x.key === key);
    if (!p) throw new Error("Plugin não encontrado.");
    return p;
  }
  manifest(key: string): Manifest {
    const m = this.manifests.get(key);
    if (!m) throw new Error(this.errors.get(key) ?? "Manifesto do plugin não carregado.");
    return m;
  }

  // Passo 1: copia (ou baixa) o plugin para uma pasta temporária e mostra o que ele pede.
  async prepare(source: PluginSource): Promise<PluginPreview> {
    for (const [token, s] of this.staged) if (Date.now() - s.at > 30 * 60_000) await this.discard(token);
    const token = randomUUID();
    const dir = join(this.deps.root, "staging", token);
    await mkdir(dir, { recursive: true });
    try {
      let publisher = "local";
      let pluginDir = dir;
      if (source.kind === "git") {
        const url = source.location.trim();
        if (url.startsWith("-") || !/^(https?:\/\/|ssh:\/\/|git@)/i.test(url)) throw new Error("Use um link https:// ou git@ do repositório.");
        publisher = gitOwner(url);
        await run("git", ["clone", "--depth", "1", "--", url, join(dir, "repo")], {
          timeout: 120_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        pluginDir = join(dir, "repo");
        await rm(join(pluginDir, ".git"), { recursive: true, force: true });
      } else if (source.kind === "zip") {
        await extractZip(await readFile(source.location), dir);
      } else if (source.dev) {
        pluginDir = source.location;
      } else {
        await copyPlugin(source.location, dir);
      }
      if (!existsSync(join(pluginDir, MANIFEST))) throw new Error(`Não há ${MANIFEST} na raiz do plugin.`);
      await refuseLinks(pluginDir);
      const manifest = parseManifest(await readFile(join(pluginDir, MANIFEST), "utf8"));
      const key = `${publisher}.${manifest.id}`;
      this.staged.set(token, { dir: pluginDir, source, manifest, publisher, at: Date.now() });
      const old = this.index.find((p) => p.key === key);
      const oldManifest = old && this.manifests.get(key);
      return {
        token,
        key,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        publisher,
        dev: Boolean(source.dev),
        runsCode: Boolean(manifest.main),
        capabilities: manifest.capabilities.map((kind) => ({ kind, text: CAPABILITIES[kind] ?? `Permissão desconhecida: ${kind}` })),
        unsupported: unsupported(manifest),
        editors: manifest.customEditors.map((e) => `${e.title} (${[...e.extensions, ...e.filenames].join(", ")})`),
        replaces: old
          ? { version: oldManifest?.version ?? "?", newCapabilities: manifest.capabilities.filter((c) => !old.granted.includes(c)) }
          : undefined,
      };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  async discard(token: string) {
    this.staged.delete(token);
    await rm(join(this.deps.root, "staging", token), { recursive: true, force: true });
  }

  // Passo 2: o usuário aprovou. Substitui a versão anterior, se houver, mantendo os dados.
  async install(token: string): Promise<PluginInfo> {
    const staged = this.staged.get(token);
    if (!staged) throw new Error("A instalação expirou. Escolha o plugin de novo.");
    this.staged.delete(token);
    const key = `${staged.publisher}.${staged.manifest.id}`;
    this.stop(key);
    let path = staged.dir;
    if (!staged.source.dev) {
      path = join(this.deps.root, "installed", key);
      await rm(path, { recursive: true, force: true });
      await rename(staged.dir, path);
    }
    await rm(join(this.deps.root, "staging", token), { recursive: true, force: true });
    const entry: InstalledPlugin = {
      key,
      id: staged.manifest.id,
      publisher: staged.publisher,
      path,
      source: staged.source,
      enabled: true,
      granted: staged.manifest.capabilities,
      installedAt: new Date().toISOString(),
    };
    this.index = [...this.index.filter((p) => p.key !== key), entry];
    await this.saveIndex();
    await this.readManifest(entry);
    return this.list().find((p) => p.key === key)!;
  }

  async remove(key: string) {
    const p = this.plugin(key);
    this.stop(key);
    if (!p.source.dev) await rm(p.path, { recursive: true, force: true });
    await rm(this.dataFile(key), { force: true });
    this.cache.delete(key);
    this.index = this.index.filter((x) => x.key !== key);
    this.manifests.delete(key);
    await this.saveIndex();
  }

  async setEnabled(key: string, enabled: boolean) {
    const p = this.plugin(key);
    p.enabled = enabled;
    if (!enabled) this.stop(key);
    await this.saveIndex();
  }

  // Plugin em desenvolvimento: relê o manifesto e reinicia o worker com o código novo.
  async reload(key: string) {
    const p = this.plugin(key);
    this.stop(key);
    await this.readManifest(p);
  }

  async setSettings(key: string, values: Record<string, unknown>) {
    const m = this.manifest(key);
    const data = await this.data(key);
    for (const s of m.settings) {
      if (!(s.key in values)) continue;
      const v = values[s.key];
      const ok =
        s.type === "boolean" ? typeof v === "boolean" : s.type === "string" ? typeof v === "string" : typeof v === "number" && Number.isFinite(v);
      if (!ok) throw new Error(`Valor inválido para "${s.title}".`);
      if (typeof v === "number" && ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum)))
        throw new Error(`"${s.title}" precisa ficar entre ${s.minimum ?? "-∞"} e ${s.maximum ?? "∞"}.`);
      data.settings[s.key] = s.type === "integer" ? Math.round(v as number) : v;
    }
    await this.saveData(key, data);
  }

  // Dados do plugin. Mantidos em memória depois da primeira leitura; gravados a cada mudança.
  private cache = new Map<string, Data>();
  private dataSync(key: string) {
    return this.cache.get(key);
  }
  private async data(key: string): Promise<Data> {
    let data = this.cache.get(key);
    if (!data) {
      try {
        data = JSON.parse(await readFile(this.dataFile(key), "utf8")) as Data;
      } catch {
        data = { storage: {}, secrets: {}, settings: {} };
      }
      this.cache.set(key, data);
    }
    return data;
  }
  private async saveData(key: string, data: Data) {
    await mkdir(join(this.deps.root, "data"), { recursive: true });
    const file = this.dataFile(key);
    await writeFile(file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    await rename(file + ".tmp", file);
  }
  async loadSettings() {
    for (const p of this.index) await this.data(p.key);
  }

  // O editor ou o painel pediu algo ao worker: sobe o worker se preciso e repassa.
  async request(key: string, name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    const p = this.plugin(key);
    if (!p.enabled) throw new Error("O plugin está desativado.");
    const worker = this.worker(key);
    await worker.ready;
    const id = ++this.requests;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        worker.requests.delete(id);
        worker.channel.postMessage({ type: "cancel", id });
        fail(Object.assign(new Error("O plugin demorou demais para responder."), { code: "timeout" }));
      }, REQUEST_LIMIT_MS);
      worker.requests.set(id, {
        done: (v) => (clearTimeout(timer), done(v)),
        fail: (e) => (clearTimeout(timer), fail(e)),
      });
      signal?.addEventListener("abort", () => worker.channel.postMessage({ type: "cancel", id }), { once: true });
      worker.channel.postMessage({ type: "request", id, name, input });
    });
  }

  private worker(key: string): Worker {
    const existing = this.workers.get(key);
    if (existing) return existing;
    const p = this.plugin(key);
    const m = this.manifest(key);
    if (!m.main) throw new Error("Este plugin não tem worker (main).");
    const channel = this.deps.spawn(key);
    let ready!: () => void;
    let failed!: (e: Error) => void;
    const worker: Worker = {
      channel,
      ready: new Promise<void>((a, b) => ((ready = a), (failed = b))),
      requests: new Map(),
    };
    worker.ready.catch(() => this.workers.delete(key));
    this.workers.set(key, worker);
    channel.onMessage((msg) => {
      if (msg?.type === "ready") ready();
      else if (msg?.type === "failed") {
        this.deps.log(key, `O worker não iniciou: ${msg.error?.message}`);
        failed(new Error(`O plugin não iniciou: ${msg.error?.message}`));
        this.stop(key);
      } else if (msg?.type === "response") {
        const r = worker.requests.get(msg.id);
        worker.requests.delete(msg.id);
        if (msg.ok) r?.done(msg.value);
        else r?.fail(Object.assign(new Error(msg.error?.message ?? "Erro no plugin"), { code: msg.error?.code }));
      } else if (msg?.type === "call") {
        void this.answer(key, msg.method, msg.args).then(
          (value) => channel.postMessage({ type: "result", id: msg.id, ok: true, value: value === undefined ? null : value }),
          (error: Error & { code?: string }) =>
            channel.postMessage({ type: "result", id: msg.id, ok: false, error: { code: error.code ?? "error", message: error.message } }),
        );
      } else if (msg?.type === "post" && typeof msg.event === "string") this.deps.post(key, msg.event, msg.data ?? {});
      else if (msg?.type === "log") this.deps.log(key, String(msg.text));
    });
    channel.onExit(() => {
      if (this.workers.get(key) !== worker) return;
      this.workers.delete(key);
      for (const r of worker.requests.values()) r.fail(new Error("O worker do plugin parou."));
      failed(new Error("O worker do plugin parou."));
    });
    channel.postMessage({ type: "start", dir: p.path, main: m.main });
    return worker;
  }

  stop(key: string) {
    const worker = this.workers.get(key);
    if (!worker) return;
    this.workers.delete(key);
    for (const r of worker.requests.values()) r.fail(new Error("O plugin foi reiniciado."));
    worker.channel.kill();
  }
  stopAll() {
    for (const key of [...this.workers.keys()]) this.stop(key);
  }

  private need(key: string, capability: string) {
    if (!this.plugin(key).granted.includes(capability))
      throw Object.assign(new Error(`O plugin não tem a permissão ${capability}.`), { code: "permission-denied" });
  }

  // Chamadas do worker ao Golfinho, liberadas pelas permissões aprovadas.
  private async answer(key: string, method: string, args: any): Promise<unknown> {
    const data = await this.data(key);
    const k = typeof args?.key === "string" ? args.key : "";
    switch (method) {
      case "storage.get":
        this.need(key, "storage:own");
        return data.storage[k] ?? null;
      case "storage.keys":
        this.need(key, "storage:own");
        return Object.keys(data.storage);
      case "storage.set":
        this.need(key, "storage:own");
        if (JSON.stringify(args?.value ?? null).length > 16 * 1024 * 1024) throw new Error("Valor grande demais para o armazenamento.");
        data.storage[k] = args?.value ?? null;
        await this.saveData(key, data);
        return null;
      case "storage.delete":
        this.need(key, "storage:own");
        delete data.storage[k];
        await this.saveData(key, data);
        return null;
      case "secrets.get":
        this.need(key, "secrets:own");
        return data.secrets[k] ? this.deps.vault.decrypt(data.secrets[k]) : null;
      case "secrets.set":
        this.need(key, "secrets:own");
        if (!this.deps.vault.available()) throw new Error("O cofre do sistema não está disponível.");
        data.secrets[k] = this.deps.vault.encrypt(String(args?.value ?? ""));
        await this.saveData(key, data);
        return null;
      case "secrets.delete":
        this.need(key, "secrets:own");
        delete data.secrets[k];
        await this.saveData(key, data);
        return null;
      case "settings.get":
        return settingValues(this.manifest(key), data.settings);
      case "host.call":
        return this.hostCall(key, String(args?.name ?? ""), args?.args);
    }
    throw Object.assign(new Error(`Chamada desconhecida: ${method}`), { code: "unsupported" });
  }

  private hostCall(key: string, name: string, args: any): unknown {
    switch (name) {
      case "workspace.list":
        this.need(key, "workspace:read");
        return { workspaces: this.deps.workspaces() };
      case "workspace.readContext":
        this.need(key, "workspace:read");
        return this.deps.context();
      case "secrets.protection":
        return { status: this.deps.vault.available() ? "os-keyring" : "unavailable" };
      case "notifications.show":
        this.need(key, "notifications:show");
        this.deps.notify(String(args?.title ?? ""), String(args?.body ?? ""));
        return { delivered: true };
    }
    throw Object.assign(new Error(`O Golfinho ainda não oferece "${name}" aos plugins.`), { code: "unsupported" });
  }
}

// Cópia da pasta do plugin, sem node_modules nem .git e sem seguir links simbólicos.
async function copyPlugin(from: string, to: string) {
  await cp(from, to, {
    recursive: true,
    filter: (src) => !SKIP.has(basename(src)),
    verbatimSymlinks: true,
  });
}

// O ORCA recusa links simbólicos na pasta do plugin; o Golfinho também.
async function refuseLinks(dir: string, depth = 0): Promise<void> {
  if (depth > 20) throw new Error("A pasta do plugin tem subpastas demais.");
  for (const name of await readdir(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`O plugin tem um link simbólico (${name}). Tire o link e tente de novo.`);
    if (info.isDirectory()) await refuseLinks(path, depth + 1);
  }
}
