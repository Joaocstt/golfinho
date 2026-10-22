import React from "react";
import manifest from "material-icon-theme/dist/material-icons.json";

// Ícones de arquivo e pasta do Material Icon Theme (a extensão do VS Code, licença MIT). O
// manifesto do pacote diz qual ícone cada nome, extensão ou linguagem usa; os SVGs vêm da
// pasta icons do pacote e entram no build como arquivos (ou inline, quando pequenos).
const svgs = import.meta.glob<string>("../../node_modules/material-icon-theme/icons/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});
const urls = new Map<string, string>();
for (const [path, url] of Object.entries(svgs)) urls.set(path.slice(path.lastIndexOf("/") + 1, -4), url);

interface Manifest {
  iconDefinitions: Record<string, { iconPath: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  languageIds: Record<string, string>;
  file: string;
  folder: string;
  folderExpanded: string;
  rootFolder: string;
  rootFolderExpanded: string;
}
const theme = manifest as unknown as Manifest;

// No VS Code, várias extensões chegam ao ícone pela linguagem do arquivo, e não pela extensão.
// Aqui não há detecção de linguagem: este mapa cobre as extensões mais comuns.
const LANGUAGES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  json: "json", jsonc: "jsonc", md: "markdown", markdown: "markdown",
  py: "python", rb: "ruby", php: "php", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  go: "go", rs: "rust", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  css: "css", scss: "scss", sass: "sass", less: "less", html: "html", htm: "html", vue: "vue",
  xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", sql: "sql", lua: "lua",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", ps1: "powershell", bat: "bat",
  dart: "dart", r: "r", pl: "perl", scala: "scala", ex: "elixir", exs: "elixir", erl: "erlang",
  hs: "haskell", clj: "clojure", fs: "fsharp", tex: "latex", txt: "plaintext", log: "log",
  dockerfile: "dockerfile", graphql: "graphql", gql: "graphql", svelte: "svelte",
};

// Nome do SVG (sem extensão) de um id do manifesto.
function iconName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const path = theme.iconDefinitions[id]?.iconPath;
  return path ? path.slice(path.lastIndexOf("/") + 1, -4) : id;
}

// Mesma ordem do VS Code: nome exato, depois a extensão mais longa ("test.tsx" antes de "tsx"),
// depois a linguagem e, por fim, o ícone genérico.
export function fileIcon(name: string): string | undefined {
  const lower = name.toLowerCase();
  const byName = theme.fileNames[lower] ?? theme.fileNames[name];
  if (byName) return iconName(byName);
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    if (theme.fileExtensions[ext]) return iconName(theme.fileExtensions[ext]);
  }
  const language = LANGUAGES[parts.length > 1 ? parts[parts.length - 1] : lower];
  if (language && theme.languageIds[language]) return iconName(theme.languageIds[language]);
  return iconName(theme.file);
}

export function folderIcon(name: string, open = false, root = false): string | undefined {
  if (root) return iconName(open ? theme.rootFolderExpanded : theme.rootFolder);
  const lower = name.toLowerCase();
  const id = open ? theme.folderNamesExpanded[lower] : theme.folderNames[lower];
  return iconName(id) ?? iconName(open ? theme.folderExpanded : theme.folder);
}

const urlOf = (icon: string | undefined) => (icon ? urls.get(icon) : undefined);
export const fileIconUrl = (name: string) => urlOf(fileIcon(name)) ?? urlOf(iconName(theme.file));
export const folderIconUrl = (name: string, open = false, root = false) =>
  urlOf(folderIcon(name, open, root)) ?? urlOf(iconName(open ? theme.folderExpanded : theme.folder));

export function FileTypeIcon({
  name,
  kind = "file",
  open = false,
  root = false,
  size = 16,
  className,
}: {
  name: string;
  kind?: "file" | "directory";
  open?: boolean;
  root?: boolean;
  size?: number;
  className?: string;
}) {
  const src = kind === "directory" ? folderIconUrl(name, open, root) : fileIconUrl(name);
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={"file-type-icon" + (className ? ` ${className}` : "")}
    />
  );
}
