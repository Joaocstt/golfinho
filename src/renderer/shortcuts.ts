// Atalhos multiplataforma (Linux, Windows e macOS).
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
}

export function findShortcutLabel(): string {
  return isMac() ? "⌘F" : "Ctrl+F";
}

export function isFindShortcut(event: {
  type?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  key: string;
}): boolean {
  return (
    (event.type === undefined || event.type === "keydown") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "f"
  );
}
