// Faixas de linha de uma mudança, no formato que o Monaco devolve em getLineChanges().
export interface LineRange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}
// Conta linhas a partir das mudanças que o próprio Monaco calculou. Um trecho só de remoção vem
// com o fim da faixa nova em 0, e o contrário para adição pura.
export function countLines(changes: LineRange[]) {
  let added = 0;
  let removed = 0;
  for (const c of changes) {
    if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
    if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1;
  }
  return { added, removed, hunks: changes.length };
}
