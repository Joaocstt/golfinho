import { app, net } from "electron";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, constants, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../shared/contracts";
import { INSTALL_SCRIPT, RELEASES, appBundle, isNewer, parseLatestMac, pickZip, type MacRelease } from "./macUpdate";

// electron-updater é CommonJS: o import nomeado quebra no app empacotado (ESM),
// então carregamos com require e mantemos os tipos do pacote.
const { autoUpdater } = createRequire(import.meta.url)("electron-updater") as typeof import("electron-updater");

// Nada acontece sozinho: o usuário verifica, decide baixar e decide reiniciar.
export interface Updater {
  status(): UpdateStatus;
  check(): void;
  download(): void;
  // O encerramento limpo é responsabilidade de quem chama.
  installNow(): void;
}

// AppImage é o único formato Linux que o electron-updater atualiza sozinho.
function supported() {
  if (!app.isPackaged) return false;
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  return true;
}

const message = (error: unknown) =>
  /net::|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/.test(String(error))
    ? "Sem conexão com o GitHub. Tente de novo mais tarde."
    : "Não foi possível verificar atualizações.";

export function startUpdater(notify: (status: UpdateStatus) => void): Updater {
  let current: UpdateStatus = supported() ? { state: "idle" } : { state: "unsupported" };
  const set = (status: UpdateStatus) => {
    current = status;
    notify(status);
  };
  if (current.state === "unsupported") return { status: () => current, check() {}, download() {}, installNow() {} };
  if (process.platform === "darwin") return startMacUpdater(set, () => current);

  let version = "";
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    version = info.version;
    set({ state: "available", version });
  });
  autoUpdater.on("update-not-available", () => set({ state: "latest", version: app.getVersion() }));
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    set({ state: "downloading", version, percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    set({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", (error: Error) => {
    console.error("Falha ao atualizar:", error);
    if (current.state === "checking" || current.state === "downloading") set({ state: "error", message: message(error) });
  });

  return {
    status: () => current,
    check: () => {
      if (current.state === "checking" || current.state === "downloading" || current.state === "ready") return;
      set({ state: "checking" });
      void autoUpdater.checkForUpdates().catch(() => undefined);
    },
    download: () => {
      if (current.state !== "available") return;
      set({ state: "downloading", version, percent: 0 });
      void autoUpdater.downloadUpdate().catch(() => undefined);
    },
    installNow: () => autoUpdater.quitAndInstall(),
  };
}

// macOS: o app não é assinado, então a atualização é nossa (veja macUpdate.ts).
function startMacUpdater(set: (status: UpdateStatus) => void, current: () => UpdateStatus): Updater {
  const bundle = appBundle(process.execPath);
  const work = join(app.getPath("temp"), "golfinho-update");
  let release: MacRelease | null = null;
  let ready: string | null = null;

  const check = async () => {
    set({ state: "checking" });
    try {
      const res = await net.fetch(`${RELEASES}/latest/download/latest-mac.yml`);
      if (!res.ok) throw new Error(`latest-mac.yml: HTTP ${res.status}`);
      const latest = parseLatestMac(await res.text());
      if (!isNewer(latest.version, app.getVersion())) return set({ state: "latest", version: app.getVersion() });
      release = latest;
      set({ state: "available", version: latest.version });
    } catch (error) {
      console.error("Falha ao verificar atualização:", error);
      set({ state: "error", message: message(error) });
    }
  };

  const download = async (latest: MacRelease) => {
    const zip = pickZip(latest, process.arch);
    set({ state: "downloading", version: latest.version, percent: 0 });
    try {
      if (!bundle || !zip) throw new Error("Release sem o .zip deste Mac.");
      // Rodando de dentro do .dmg ou numa pasta sem permissão não dá para trocar o app.
      if (bundle.startsWith("/Volumes/")) throw new Error("dmg");
      await access(join(bundle, ".."), constants.W_OK);
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const file = join(work, "golfinho.zip");
      const res = await net.fetch(`${RELEASES}/download/v${latest.version}/${zip.url}`);
      if (!res.ok || !res.body) throw new Error(`${zip.url}: HTTP ${res.status}`);
      const hash = createHash("sha512");
      let received = 0;
      let shown = 0;
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          received += chunk.length;
          const percent = zip.size ? Math.min(99, Math.floor((received / zip.size) * 100)) : 0;
          if (percent !== shown) {
            shown = percent;
            set({ state: "downloading", version: latest.version, percent });
          }
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), progress, createWriteStream(file));
      if (hash.digest("base64") !== zip.sha512) throw new Error("O arquivo baixado não confere com a release (sha512).");
      const extracted = join(work, "app");
      await promisify(execFile)("ditto", ["-x", "-k", file, extracted]);
      await rm(file, { force: true });
      ready = join(extracted, "Golfinho.app");
      set({ state: "ready", version: latest.version });
    } catch (error) {
      console.error("Falha ao baixar atualização:", error);
      const where = String(error).includes("dmg") || String(error).includes("EACCES")
        ? "Mova o Golfinho para Aplicativos para ele poder se atualizar."
        : message(error).replace("verificar atualizações", "baixar a atualização");
      set({ state: "error", message: where });
    }
  };

  return {
    status: current,
    check: () => {
      const state = current().state;
      if (state !== "checking" && state !== "downloading" && state !== "ready") void check();
    },
    download: () => {
      if (current().state === "available" && release) void download(release);
    },
    installNow: () => {
      if (!ready || !bundle) return app.quit();
      spawn("/bin/sh", ["-c", INSTALL_SCRIPT, "golfinho-update", String(process.pid), ready, bundle], {
        detached: true,
        stdio: "ignore",
      }).unref();
      app.quit();
    },
  };
}
