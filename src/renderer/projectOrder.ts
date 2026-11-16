// Ordem dos projetos na barra lateral, escolhida pelo usuário arrastando. Preferência de tela:
// fica neste computador, como os projetos recolhidos. Projeto que não está na lista (acabou de
// ser adicionado) vai para o fim, na ordem em que foi adicionado.

const KEY = "golfinho.ui.projectOrder";

export function loadOrder(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveOrder(order: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

export function sortByOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, key: rank.get(item.id) ?? order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item);
}

// Tira `moving` do lugar e põe antes (ou depois) de `target`. Devolve a ordem nova dos ids.
export function moveBefore(ids: string[], moving: string, target: string, after = false): string[] {
  if (moving === target || !ids.includes(moving) || !ids.includes(target)) return ids;
  const rest = ids.filter((id) => id !== moving);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
