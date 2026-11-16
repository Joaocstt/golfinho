import { useEffect, useState } from "react";

// Plugins no formato do ORCA, do lado da interface: a lista dos instalados e qual editor de
// plugin abre um arquivo. A instalação e o worker ficam no processo principal.

export interface PluginInfo {
  key: string;
  id: string;
  publisher: string;
  name: string;
  version: string;
  description: string;
  path: string;
  source: { kind: "folder" | "zip" | "git"; location: string; dev?: boolean };
  enabled: boolean;
  granted: string[];
  editors: { id: string; title: string; extensions: string[]; filenames: string[] }[];
  panels: { id: string; title: string; icon: string }[];
  syntaxes: { id: string; title: string; scopeName: string; extensions: string[]; filenames: string[] }[];
  newFiles: { id: string; title: string; extension: string }[];
  settings: { key: string; title: string; type: "string" | "number" | "integer" | "boolean"; description?: string; enum?: (string | number)[]; minimum?: number; maximum?: number }[];
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
  replaces?: { version: string; newCapabilities: string[] };
}

export const pluginRequest = <T,>(r: { action: string; [field: string]: unknown }) => {
  const api = window.golfinho?.plugins;
  if (!api) return Promise.reject(new Error("Plugins não estão disponíveis aqui."));
  return api.request(r) as Promise<T>;
};

// Avisa quem mostra a lista quando um plugin é instalado, removido ou ligado/desligado.
const listeners = new Set<() => void>();
export const pluginsChanged = () => listeners.forEach((l) => l());

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  useEffect(() => {
    if (!window.golfinho?.plugins) return;
    let alive = true;
    const load = () =>
      void pluginRequest<PluginInfo[]>({ action: "list" })
        .then((list) => alive && setPlugins(list))
        .catch(() => alive && setPlugins([]));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, []);
  return plugins;
}

// Editor de plugin para o arquivo, pela extensão (".http") ou pelo nome exato.
export function pluginEditorFor(path: string, plugins: PluginInfo[]) {
  const name = path.split(/[\\/]/).pop() ?? path;
  const lower = name.toLowerCase();
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const editor of plugin.editors)
      if (editor.filenames.includes(name) || editor.extensions.some((ext) => lower.endsWith(ext))) return { plugin, editor };
  }
  return null;
}
