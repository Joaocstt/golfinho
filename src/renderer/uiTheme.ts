// Tema da interface. Como a escala, é preferência de tela e fica no navegador do usuário.
// O escuro é o padrão; "sistema" acompanha o Windows/macOS e muda junto com ele.
export type UiTheme = "dark" | "light" | "system";
export const UI_THEME_KEY = "golfinho.ui.theme";
export const UI_THEMES: { value: UiTheme; label: string }[] = [
  { value: "dark", label: "Escuro" },
  { value: "light", label: "Claro" },
  { value: "system", label: "Do sistema" },
];

export function readUiTheme(): UiTheme {
  try {
    const stored = localStorage.getItem(UI_THEME_KEY);
    return UI_THEMES.some((t) => t.value === stored) ? (stored as UiTheme) : "dark";
  } catch {
    return "dark";
  }
}

let stopFollowing: (() => void) | null = null;

export function applyUiTheme(theme: UiTheme) {
  stopFollowing?.();
  stopFollowing = null;
  const set = (light: boolean) => {
    if (light) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
  };
  if (theme === "system" && typeof window.matchMedia === "function") {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => set(query.matches);
    follow();
    query.addEventListener?.("change", follow);
    stopFollowing = () => query.removeEventListener?.("change", follow);
  } else set(theme === "light");
  try {
    localStorage.setItem(UI_THEME_KEY, theme);
  } catch {
    // Sem armazenamento disponível o tema vale só nesta sessão.
  }
}
