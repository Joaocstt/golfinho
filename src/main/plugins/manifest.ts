// Plugins no formato do ORCA (orca-plugin.json, manifesto 2): o mesmo plugin roda no ORCA e no
// Golfinho. Aqui só se lê e confere o manifesto; nada do plugin é executado.

export const MANIFEST = "orca-plugin.json";

export type Execution = "data" | "declarative" | "sandboxed-ui" | "trusted-worker";

export interface CustomEditor {
  id: string;
  title: string;
  entry: string;
  extensions: string[];
  filenames: string[];
}

export interface Panel {
  id: string;
  title: string;
  icon: string;
  entry: string;
  ui: "html" | "components";
}

export interface Syntax {
  id: string;
  title: string;
  scopeName: string;
  path: string;
  configuration?: string;
  extensions: string[];
  filenames: string[];
}

export interface NewFile {
  id: string;
  title: string;
  extension: string;
  template?: string;
}

export interface PluginSetting {
  key: string;
  title: string;
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  default?: string | number | boolean;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description: string;
  execution: Execution;
  engine: string;
  main?: string;
  capabilities: string[];
  customEditors: CustomEditor[];
  panels: Panel[];
  syntaxes: Syntax[];
  newFiles: NewFile[];
  settings: PluginSetting[];
  /** Tudo o que o manifesto traz em `contributes`, para avisar o que o Golfinho ainda não usa. */
  contributes: Record<string, unknown[]>;
}

// O que cada permissão libera, em português, para a tela de aprovação.
export const CAPABILITIES: Record<string, string> = {
  "workspace:read": "Ver os projetos e a tarefa aberta (nome, pasta e branch)",
  "workspace:write": "Alterar arquivos dos projetos",
  "workspace:create": "Criar projetos e tarefas",
  "agent:read": "Ver o andamento dos agentes",
  "agent:launch": "Iniciar agentes",
  "terminal:send": "Digitar nos terminais",
  "terminal:read": "Ler o que aparece nos terminais",
  "notifications:show": "Mostrar avisos",
  "storage:own": "Guardar dados próprios",
  "secrets:own": "Guardar segredos próprios no cofre do sistema",
  "settings:own": "Ter configurações próprias",
  "appearance:write": "Mudar a aparência do app",
  "automation:read": "Ver automações",
  "automation:write": "Criar e alterar automações",
  "history:read": "Ler o histórico",
};

// Contribuições que o Golfinho já sabe usar. O resto é aceito, mas fica sem efeito (e a tela avisa).
export const SUPPORTED = new Set(["customEditors", "settings", "panels", "syntaxes", "newFiles"]);

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(["constructor", "prototype"]);

function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`O manifesto não tem "${field}".`);
  if (value.length > max) throw new Error(`"${field}" no manifesto é longo demais.`);
  return value.trim();
}

// Caminho de dentro do plugin: relativo, sem subir de pasta.
export function pluginPath(value: unknown, field: string): string {
  const path = text(value, field, 300).replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").includes(".."))
    throw new Error(`"${field}" precisa ser um caminho dentro do plugin.`);
  return path;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown) => list(value).filter((x): x is string => typeof x === "string");

export function parseManifest(raw: string): Manifest {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${MANIFEST} não é um JSON válido.`);
  }
  if (!data || typeof data !== "object") throw new Error(`${MANIFEST} não é um objeto.`);
  if (data.manifestVersion !== 2) throw new Error("Só o manifesto 2 do ORCA é aceito (manifestVersion: 2).");
  const id = text(data.id, "id", 64);
  if (!ID.test(id) || RESERVED.has(id)) throw new Error(`"${id}" não é um id válido (use kebab-case).`);
  const execution = data.execution as Execution;
  if (!["data", "declarative", "sandboxed-ui", "trusted-worker"].includes(execution))
    throw new Error(`"execution" inválido: ${String(data.execution)}.`);
  const engines = (data.engines ?? {}) as Record<string, unknown>;
  const main = data.main === undefined ? undefined : pluginPath(data.main, "main");
  if (main && execution !== "trusted-worker") throw new Error(`"main" exige "execution": "trusted-worker".`);
  const contributes = (data.contributes && typeof data.contributes === "object" ? data.contributes : {}) as Record<string, unknown>;
  const customEditors = list(contributes.customEditors).map((item, i) => {
    const e = item as Record<string, unknown>;
    return {
      id: text(e.id, `customEditors[${i}].id`, 64),
      title: text(e.title, `customEditors[${i}].title`),
      entry: pluginPath(e.entry, `customEditors[${i}].entry`),
      extensions: strings(e.extensions).map((x) => x.toLowerCase()),
      filenames: strings(e.filenames),
    };
  });
  const panels = list(contributes.panels).map((item, i) => {
    const p = item as Record<string, unknown>;
    return {
      id: text(p.id, `panels[${i}].id`, 64),
      title: text(p.title, `panels[${i}].title`),
      icon: typeof p.icon === "string" ? p.icon : "plug",
      entry: pluginPath(p.entry, `panels[${i}].entry`),
      ui: p.ui === "components" ? ("components" as const) : ("html" as const),
    };
  });
  const syntaxes = list(contributes.syntaxes).map((item, i) => {
    const x = item as Record<string, unknown>;
    return {
      id: text(x.id, `syntaxes[${i}].id`, 64),
      title: text(x.title, `syntaxes[${i}].title`),
      scopeName: text(x.scopeName, `syntaxes[${i}].scopeName`),
      path: pluginPath(x.path, `syntaxes[${i}].path`),
      configuration: x.configuration === undefined ? undefined : pluginPath(x.configuration, `syntaxes[${i}].configuration`),
      extensions: strings(x.extensions).map((e) => e.toLowerCase()),
      filenames: strings(x.filenames),
    };
  });
  const newFiles = list(contributes.newFiles).map((item, i) => {
    const x = item as Record<string, unknown>;
    const extension = text(x.extension, `newFiles[${i}].extension`, 32);
    return {
      id: text(x.id, `newFiles[${i}].id`, 64),
      title: text(x.title, `newFiles[${i}].title`),
      extension: extension.startsWith(".") ? extension : `.${extension}`,
      template: x.template === undefined ? undefined : pluginPath(x.template, `newFiles[${i}].template`),
    };
  });
  const settings = list(contributes.settings).map((item, i) => {
    const s = item as Record<string, unknown>;
    const type = s.type as PluginSetting["type"];
    if (!["string", "number", "integer", "boolean"].includes(type)) throw new Error(`settings[${i}]: tipo inválido.`);
    return {
      key: text(s.key, `settings[${i}].key`, 64),
      title: text(s.title, `settings[${i}].title`),
      type,
      description: typeof s.description === "string" ? s.description : undefined,
      default: s.default as PluginSetting["default"],
      enum: Array.isArray(s.enum) ? (s.enum as (string | number)[]) : undefined,
      minimum: typeof s.minimum === "number" ? s.minimum : undefined,
      maximum: typeof s.maximum === "number" ? s.maximum : undefined,
    };
  });
  return {
    id,
    name: text(data.name, "name", 80),
    version: text(data.version, "version", 40),
    description: typeof data.description === "string" ? data.description.slice(0, 500) : "",
    execution,
    engine: typeof engines.orca === "string" ? engines.orca : "",
    main,
    capabilities: list(data.capabilities)
      .map((c) => (c && typeof c === "object" ? (c as { kind?: unknown }).kind : undefined))
      .filter((k): k is string => typeof k === "string"),
    customEditors,
    panels,
    syntaxes,
    newFiles,
    settings,
    contributes: Object.fromEntries(Object.entries(contributes).map(([k, v]) => [k, list(v)])),
  };
}

// Contribuições que o plugin traz e o Golfinho ainda não usa ("panels: 1, syntaxes: 1").
// Painel em HTML (ui: "html") ainda não: só os de componentes.
export function unsupported(m: Manifest): string[] {
  const html = m.panels.filter((p) => p.ui === "html").length;
  return [
    ...Object.entries(m.contributes)
      .filter(([key, items]) => items.length > 0 && !SUPPORTED.has(key))
      .map(([key, items]) => `${key} (${items.length})`),
    ...(html ? [`panels em HTML (${html})`] : []),
  ];
}

// Valor de cada configuração: o que o usuário salvou, ou o padrão do manifesto.
export function settingValues(m: Manifest, saved: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const s of m.settings) values[s.key] = s.key in saved ? saved[s.key] : s.default;
  return values;
}
