import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { parseManifest, unsupported } from "../src/main/plugins/manifest";
import { readZip } from "../src/main/plugins/zip";
import { PluginManager, gitOwner, type Channel } from "../src/main/plugins/manager";
import { toJs } from "../src/main/plugins/transpile";

const roots: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `golfinho-${name}-`));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// O mesmo formato do http-client do ORCA, resumido.
const manifest = {
  manifestVersion: 2,
  id: "http-client",
  name: "HTTP Client",
  version: "0.1.0",
  engines: { orca: ">=1.4.248" },
  execution: "trusted-worker",
  pluginApi: 1,
  main: "src/worker.ts",
  contributes: {
    panels: [{ id: "http-client", title: "HTTP Client", entry: "src/panel.tsx", ui: "components" }],
    customEditors: [{ id: "http-file", title: "HTTP Client", extensions: [".http", ".REST"], entry: "src/editor/main.ts" }],
    settings: [{ key: "timeoutMs", title: "Tempo limite (ms)", type: "integer", default: 30000, minimum: 1000, maximum: 110000 }],
  },
  capabilities: [{ kind: "storage:own" }, { kind: "secrets:own" }, { kind: "workspace:read" }],
};

// Zip mínimo, escrito aqui para o teste não depender do programa zip (que o Windows não tem).
function zip(files: Record<string, string>, { symlink }: { symlink?: string } = {}) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const packed = deflateRawSync(data);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(((name === symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed);
    centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function pluginFolder() {
  const dir = temp("plugin");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules", "lixo"), { recursive: true });
  writeFileSync(join(dir, "orca-plugin.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "src", "worker.ts"), "export default function activate() {}\n");
  writeFileSync(join(dir, "node_modules", "lixo", "x.js"), "x");
  return dir;
}

// Worker de mentira: responde como o host responderia, e registra as chamadas ao Golfinho.
function fakeWorker() {
  const sent: any[] = [];
  let listener: (m: any) => void = () => {};
  let asked = 0;
  const channel: Channel = {
    postMessage(m: any) {
      sent.push(m);
      if (m.type === "start") queueMicrotask(() => listener({ type: "ready" }));
      if (m.type === "request" && m.name === "eco") queueMicrotask(() => listener({ type: "response", id: m.id, ok: true, value: m.input }));
      if (m.type === "request" && m.name === "guardar") asked = m.id;
      if (m.type === "request" && m.name === "guardar") queueMicrotask(() => listener({ type: "call", id: 1, method: "storage.set", args: { key: "k", value: 7 } }));
      if (m.type === "result") queueMicrotask(() => listener({ type: "response", id: asked, ok: m.ok, value: m.value, error: m.error }));
    },
    onMessage: (l) => void (listener = l),
    onExit: () => {},
    kill: () => {},
  };
  return { channel, sent, emit: (m: any) => listener(m) };
}

function manager(root = temp("plugins"), worker = fakeWorker(), granted?: string[]) {
  const vault = { available: () => true, encrypt: (t: string) => `enc:${t}`, decrypt: (b: string) => b.slice(4) };
  const m = new PluginManager({
    root,
    vault,
    spawn: () => worker.channel,
    workspaces: () => [{ name: "api", path: "/p/api", branch: "main" }],
    context: () => ({ displayName: "api", branch: "main", terminals: [] }),
    notify: () => {},
    post: () => {},
    log: () => {},
  });
  void granted;
  return m;
}

describe("manifesto do ORCA", () => {
  it("lê o que o Golfinho usa e avisa o que ainda não usa", () => {
    const m = parseManifest(JSON.stringify(manifest));
    expect(m).toMatchObject({ id: "http-client", main: "src/worker.ts", capabilities: ["storage:own", "secrets:own", "workspace:read"] });
    expect(m.customEditors[0].extensions).toEqual([".http", ".rest"]);
    expect(m.panels).toEqual([{ id: "http-client", title: "HTTP Client", icon: "plug", entry: "src/panel.tsx", ui: "components" }]);
    expect(unsupported(m)).toEqual([]);
    const html = { ...manifest, contributes: { ...manifest.contributes, panels: [{ id: "p", title: "P", entry: "p.html" }], themes: [{}] } };
    expect(unsupported(parseManifest(JSON.stringify(html)))).toEqual(["themes (1)", "panels em HTML (1)"]);
  });
  it("recusa manifesto antigo, id inválido e caminho que sai do plugin", () => {
    expect(() => parseManifest(JSON.stringify({ ...manifest, manifestVersion: 1 }))).toThrow(/manifesto 2/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, id: "Http Client" }))).toThrow(/id válido/);
    expect(() => parseManifest(JSON.stringify({ ...manifest, main: "../fora.ts" }))).toThrow(/dentro do plugin/);
  });
});

describe("zip do plugin", () => {
  it("lê arquivos e recusa links simbólicos e caminhos para fora", () => {
    expect(readZip(zip({ "a/b.txt": "oi" }))).toEqual([{ path: "a/b.txt", directory: false, data: Buffer.from("oi") }]);
    expect(() => readZip(zip({ "../x": "a" }))).toThrow(/Caminho inválido/);
    expect(() => readZip(zip({ link: "/etc/passwd" }, { symlink: "link" }))).toThrow(/link simbólico/);
  });
});

describe("instalação", () => {
  it("de uma pasta: mostra o que pede, copia sem node_modules e só instala com aprovação", async () => {
    const root = temp("plugins");
    const m = manager(root);
    await m.load();
    const preview = await m.prepare({ kind: "folder", location: pluginFolder() });
    expect(preview).toMatchObject({ key: "local.http-client", runsCode: true, unsupported: [] });
    expect(preview.capabilities.map((c) => c.text)).toContain("Guardar segredos próprios no cofre do sistema");
    expect(m.list()).toEqual([]);
    const info = await m.install(preview.token);
    expect(info).toMatchObject({ key: "local.http-client", enabled: true, values: { timeoutMs: 30000 } });
    expect(existsSync(join(info.path, "src", "worker.ts"))).toBe(true);
    expect(existsSync(join(info.path, "node_modules"))).toBe(false);
    await expect(m.install(preview.token)).rejects.toThrow(/expirou/);
    // Ao abrir de novo, o plugin continua instalado.
    const again = manager(root);
    await again.load();
    expect(again.list().map((p) => p.key)).toEqual(["local.http-client"]);
  });

  it("de um .zip com a pasta do plugin dentro", async () => {
    const m = manager();
    await m.load();
    const file = join(temp("zip"), "http-client-0.1.0.zip");
    writeFileSync(file, zip({ "http-client/orca-plugin.json": JSON.stringify(manifest), "http-client/src/worker.ts": "export default () => {}" }));
    const preview = await m.prepare({ kind: "zip", location: file });
    const info = await m.install(preview.token);
    expect(readFileSync(join(info.path, "src", "worker.ts"), "utf8")).toContain("export default");
  });

  it("recusa pasta com link simbólico e pasta sem manifesto", async () => {
    const m = manager();
    await m.load();
    const linked = pluginFolder();
    symlinkSync("/etc", join(linked, "src", "etc"));
    await expect(m.prepare({ kind: "folder", location: linked })).rejects.toThrow(/link simbólico/);
    await expect(m.prepare({ kind: "folder", location: temp("vazio") })).rejects.toThrow(/orca-plugin.json/);
  });

  it("o dono do repositório vira o publisher", () => {
    expect(gitOwner("https://github.com/Joaocstt/http-client.git")).toBe("joaocstt");
    expect(gitOwner("git@github.com:joao/x.git")).toBe("joao");
    expect(() => gitOwner("http-client")).toThrow(/link do Git/);
  });
});

describe("worker e permissões", () => {
  it("repassa pedidos ao worker e libera só as permissões aprovadas", async () => {
    const worker = fakeWorker();
    const root = temp("plugins");
    const m = manager(root, worker);
    await m.load();
    const info = await m.install((await m.prepare({ kind: "folder", location: pluginFolder() })).token);
    expect(await m.request(info.key, "eco", { a: 1 })).toEqual({ a: 1 });
    expect(worker.sent[0]).toMatchObject({ type: "start", main: "src/worker.ts" });
    // storage:own foi aprovado: a gravação vai para o arquivo de dados do plugin.
    expect(await m.request(info.key, "guardar", {})).toBeNull();
    expect(JSON.parse(readFileSync(join(root, "data", "local.http-client.json"), "utf8")).storage).toEqual({ k: 7 });
  });

  it("nega o que não foi aprovado e pede a permissão pelo nome", async () => {
    const worker = fakeWorker();
    const m = manager(temp("plugins"), worker);
    await m.load();
    const folder = pluginFolder();
    writeFileSync(join(folder, "orca-plugin.json"), JSON.stringify({ ...manifest, capabilities: [] }));
    const info = await m.install((await m.prepare({ kind: "folder", location: folder })).token);
    await expect(m.request(info.key, "guardar", {})).rejects.toThrow(/permissão storage:own/);
  });

  it("plugin desativado não sobe o worker", async () => {
    const worker = fakeWorker();
    const m = manager(temp("plugins"), worker);
    await m.load();
    const info = await m.install((await m.prepare({ kind: "folder", location: pluginFolder() })).token);
    await m.setEnabled(info.key, false);
    await expect(m.request(info.key, "eco", {})).rejects.toThrow(/desativado/);
    expect(worker.sent).toEqual([]);
    expect(m.list()[0].editors).toEqual([]);
  });

  it("configurações respeitam o tipo e os limites do manifesto", async () => {
    const m = manager();
    await m.load();
    const info = await m.install((await m.prepare({ kind: "folder", location: pluginFolder() })).token);
    await m.setSettings(info.key, { timeoutMs: 5000.4 });
    expect(m.list()[0].values).toEqual({ timeoutMs: 5000 });
    await expect(m.setSettings(info.key, { timeoutMs: 10 })).rejects.toThrow(/entre 1000 e 110000/);
  });
});

describe("TypeScript do plugin", () => {
  it("tira os tipos e mantém os imports", () => {
    const js = toJs("import type { A } from './a'\nimport './protocol'\nexport const x: number = 1\n", "w.ts");
    expect(js).not.toContain("import type");
    expect(js).toContain("import './protocol'");
    expect(js).toContain("export const x = 1");
  });
});
