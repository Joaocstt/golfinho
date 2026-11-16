// Contas de caminho da árvore de arquivos. Caminhos são relativos à raiz, com "/"; "" é a raiz.
export function parentDir(path: string) {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}
export function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}
export function joinPath(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}
export function isInside(path: string, ancestor: string) {
  return ancestor === "" || path === ancestor || path.startsWith(`${ancestor}/`);
}
// Onde cola ou solta: dentro da pasta escolhida, ou ao lado do arquivo escolhido.
export function targetDir(entry: { path: string; kind: string } | null) {
  if (!entry) return "";
  return entry.kind === "directory" ? entry.path : parentDir(entry.path);
}
// Caminho de um item depois que ele (ou uma pasta acima dele) mudou de lugar.
// null quando o item foi excluído; o próprio caminho quando nada o afetou.
export function followMove(path: string, from: string, to: string | null) {
  if (path !== from && !path.startsWith(`${from}/`)) return path;
  return to === null ? null : to + path.slice(from.length);
}
// Mover para a pasta onde o item já está não faz nada; mover uma pasta para dentro dela mesma é recusado.
export function canMove(from: string, dir: string) {
  return parentDir(from) !== dir && !isInside(dir, from);
}
// Ao renomear, o nome vem selecionado sem a extensão, como no VS Code.
export function stemLength(name: string, isDirectory: boolean) {
  if (isDirectory) return name.length;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
