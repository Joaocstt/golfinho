// No Linux, o electron-updater troca o AppImage sozinho e instala o .deb novo pelo dpkg, pedindo
// a senha de administrador (pkexec). O snap se atualiza pela loja.
export function linuxPackage(env: NodeJS.ProcessEnv, read: () => string): "appimage" | "deb" | null {
  if (env.APPIMAGE) return "appimage";
  if (env.SNAP) return null;
  try {
    return read().trim() === "deb" ? "deb" : null;
  } catch {
    return null;
  }
}
