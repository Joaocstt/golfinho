// Linguagem do editor a partir do caminho: a extensão decide, sem extensão é texto puro.
export function languageFor(
  path: string,
  languages: { id: string; extensions?: string[] }[],
): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  const extension = name.slice(dot).toLowerCase();
  return languages.find((language) => language.extensions?.includes(extension))?.id ?? "plaintext";
}
