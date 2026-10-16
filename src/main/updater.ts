import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "../shared/contracts";

// Primeira checagem logo depois de abrir, depois a cada 4 horas.
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface Updater {
  status(): UpdateStatus;
  // Só instala quando o usuário pede; o encerramento limpo é responsabilidade de quem chama.
  installNow(): void;
}

// AppImage é o único formato Linux que o electron-updater atualiza sozinho.
function supported() {
  if (!app.isPackaged) return false;
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  return true;
}

export function startUpdater(notify: (status: UpdateStatus) => void): Updater {
  let current: UpdateStatus = supported() ? { state: "idle" } : { state: "unsupported" };
  let version = "";
  const set = (status: UpdateStatus) => {
    current = status;
    notify(status);
  };
  if (current.state === "unsupported") return { status: () => current, installNow() {} };

  // Baixa em segundo plano; a instalação só acontece quando o usuário clica no aviso.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info) => {
    version = info.version;
    set({ state: "downloading", version, percent: 0 });
  });
  autoUpdater.on("download-progress", (progress) => {
    set({ state: "downloading", version, percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    set({ state: "ready", version: info.version });
  });
  autoUpdater.on("update-not-available", () => set({ state: "idle" }));
  // Sem rede ou release sem arquivos não deve incomodar o usuário: registra e segue.
  autoUpdater.on("error", (error) => {
    console.error("Falha ao verificar atualização:", error);
    if (current.state === "downloading") set({ state: "idle" });
  });

  const check = () => {
    void autoUpdater.checkForUpdates().catch((error) => console.error(error));
  };
  setTimeout(check, FIRST_CHECK_MS).unref();
  setInterval(check, CHECK_EVERY_MS).unref();

  return {
    status: () => current,
    installNow: () => autoUpdater.quitAndInstall(),
  };
}
