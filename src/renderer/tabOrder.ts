// Ordem e visibilidade das abas da tarefa. Fica fora do componente para ser testada
// e para o Fast Refresh do Vite não recarregar a tarefa inteira a cada mudança.
export const TABS = ["Terminal", "Chat", "Shell", "Diff", "Commit", "Arquivos", "Histórico", "Checks"];
// Ordem das abas arrastada pelo usuário: vale para todas as tarefas desta máquina.
// Aba desconhecida some e aba nova (de uma versão futura) entra no fim.
export const ORDER_KEY = "golfinho.tabOrder";
export const ORDER_EVENT = "golfinho:tab-order";
export function storedTabOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "null");
    if (Array.isArray(saved)) {
      const known = saved.filter((t): t is string => TABS.includes(t));
      return [...new Set([...known, ...TABS])];
    }
  } catch {
    /* preferência ilegível: usa o padrão */
  }
  return TABS;
}
// Tira a aba arrastada e a põe no lugar da aba sob o cursor.
export function moveTab(order: string[], dragged: string, target: string): string[] {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order;
  const next = order.filter((t) => t !== dragged);
  next.splice(to, 0, dragged);
  return next;
}
export const HIDDEN_KEY = "golfinho.hiddenTabs";
// Abas escondidas pelo usuário. Terminal nunca some: é a aba de onde tudo começa.
export function storedHiddenTabs(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "null");
    if (Array.isArray(saved)) return saved.filter((t): t is string => TABS.includes(t) && t !== "Terminal");
  } catch {
    /* preferência ilegível: mostra todas */
  }
  return [];
}
// Monta a barra de uma tarefa: abas fixas e sessões do + numa sequência só.
// `placed` é a posição que o usuário deu nesta tarefa; as abas fixas seguem a ordem
// global nas posições que ocupam, e o que ainda não tem lugar vai para o fim.
export function arrangeTabs(placed: string[], fixed: string[], sessions: string[]): string[] {
  const valid = new Set([...fixed, ...sessions]);
  const kept = [...new Set(placed)].filter((k) => valid.has(k));
  for (const k of [...fixed, ...sessions]) if (!kept.includes(k)) kept.push(k);
  const order = fixed.filter((k) => kept.includes(k));
  let next = 0;
  return kept.map((k) => (fixed.includes(k) ? order[next++] : k));
}
// Nova ordem global das abas fixas a partir das que estão visíveis; as que não aparecem
// nesta tarefa (escondidas, ou Shell e Commit antes da branch) ficam perto de onde estavam.
export function mergeOrder(visible: string[], previous: string[]): string[] {
  const result = [...visible];
  previous.forEach((k, i) => {
    if (result.includes(k)) return;
    const before = previous.slice(0, i).reverse().find((p) => result.includes(p));
    result.splice(before ? result.indexOf(before) + 1 : 0, 0, k);
  });
  return result;
}
