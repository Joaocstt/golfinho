// Escala global da interface. Fica no navegador do usuário (localStorage), como a fonte
// do terminal: é uma preferência de tela, não um dado do app. Em monitor grande o texto
// fica pequeno, então o usuário pode aumentar tudo sem mexer no zoom do sistema.
export const UI_SCALE_KEY = "golfinho.ui.scale";
export const UI_SCALES = [
  { value: 0.9, label: "Menor (90%)" },
  { value: 1, label: "Padrão (100%)" },
  { value: 1.15, label: "Grande (115%)" },
  { value: 1.3, label: "Muito grande (130%)" },
  { value: 1.5, label: "Enorme (150%)" },
] as const;

export function readUiScale(): number {
  try {
    const stored = Number(localStorage.getItem(UI_SCALE_KEY));
    return UI_SCALES.some((s) => s.value === stored) ? stored : 1;
  } catch {
    return 1;
  }
}

export function applyUiScale(scale: number) {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  try {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Sem armazenamento disponível a escala vale só nesta sessão.
  }
}
