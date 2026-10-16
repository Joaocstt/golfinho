import { app, BrowserWindow, dialog, ipcMain, clipboard, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Store } from "./store";
import { GitService } from "./git";
import { Coordinator } from "./coordinator";
import { TerminalLogs } from "./logs";
import { ptyDriver } from "./pty";
import { Service } from "./service";
import { requestSchema } from "./schema";
import type { Signal } from "../shared/contracts";
import { Shells } from "./shells";
import { ChatManager } from "./chat";
import { vaultFrom } from "./vault";
import { configureAskpass, askpassFile } from "./ssh";
import { writeFileSync, chmodSync } from "node:fs";
import { safeStorage } from "electron";
import { exercise } from "./smoke";
import { writeFile } from "node:fs/promises";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let coordinator: Coordinator | undefined;
let store: Store | undefined;
let logs: TerminalLogs | undefined;
let shells: Shells | undefined;
let chat: ChatManager | undefined;
let closing = false;
let shutdownDone = false;
const requests = new Set<Promise<unknown>>();
if (process.env.GOLFINHO_DATA_DIR) app.setPath("userData", process.env.GOLFINHO_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const home = app.getPath("userData");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const directory = join(home, "logs");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      store = new Store(join(home, "golfinho.sqlite"));
      store.recover();
      const signal = (s: Signal) => {
        if (window && !window.isDestroyed()) window.webContents.send("golfinho:signal", s);
      };
      const changed = () => signal({ kind: "changed" });
      const git = new GitService();
      logs = new TerminalLogs(directory, signal);
      coordinator = new Coordinator(store, git, ptyDriver, logs, changed, join(home, "worktrees"));
      shells = new Shells(ptyDriver, signal);
      chat = new ChatManager((taskId, event) => signal({ kind: "chat", taskId, event }));
      // O askpass não contém segredo: lê a senha da variável que o app passa só a esse processo.
      const script = askpassFile();
      const askpass = join(home, script.name);
      writeFileSync(askpass, script.content, { mode: 0o700 });
      chmodSync(askpass, 0o700);
      configureAskpass(askpass);
      const service = new Service(store, git, coordinator, logs, changed, async () => {
        const result = await dialog.showOpenDialog(window!, {
          title: "Selecionar repositório Git",
          properties: ["openDirectory"],
        });
        return result.canceled ? null : result.filePaths[0];
      }, {
        read: () => clipboard.readText(),
        write: (text) => clipboard.writeText(text),
        // Imagem da área de transferência: salva em arquivo, para o caminho ser colado no terminal.
        image: async () => {
          for (const item of await clipboard.read()) {
            const type = item.types.find((t) => t.startsWith("image/"));
            if (!type) continue;
            const blob = await item.getType(type);
            if ("arrayBuffer" in blob) return Buffer.from(await blob.arrayBuffer());
          }
          return null;
        },
        saveImage: async (png) => {
          const dir = join(app.getPath("userData"), "clipboard");
          await mkdir(dir, { recursive: true });
          const file = join(dir, `${randomUUID()}.png`);
          await writeFile(file, png);
          return file;
        },
      }, shells, vaultFrom(safeStorage), chat);
      window = new BrowserWindow({
        width: 1400,
        height: 950,
        minWidth: 980,
        minHeight: 700,
        title: "Golfinho",
        backgroundColor: "#0b1220",
        show: false,
        webPreferences: {
          preload: join(here, "../preload/index.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.setMenuBarVisibility(false);
      // Links da CLI abrem no navegador padrão; só http e https, nada de outros esquemas.
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      ipcMain.handle("golfinho:request", async (event, input: unknown) => {
        if (closing) return { ok: false, error: "Golfinho está encerrando as execuções." };
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          return { ok: false, error: "Origem de mensagem não autorizada." };
        try {
          const r = requestSchema.parse(input);
          const pending = service.request(r);
          requests.add(pending);
          try {
            return { ok: true, value: await pending };
          } finally {
            requests.delete(pending);
          }
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      });
      window.once("ready-to-show", () => window?.show());
      window.on("closed", () => {
        window = null;
        app.quit();
      });
      if (process.env.ELECTRON_RENDERER_URL)
        await window.loadURL(process.env.ELECTRON_RENDERER_URL);
      else await window.loadFile(join(here, "../renderer/index.html"));
      if (process.env.GOLFINHO_SMOKE) {
        let integration: unknown;
        if (process.env.GOLFINHO_TEST_REPO && process.env.GOLFINHO_TEST_AGENT)
          integration = await exercise(
            service,
            store,
            process.env.GOLFINHO_TEST_REPO,
            process.env.GOLFINHO_TEST_AGENT,
          );
        const result = await window.webContents.executeJavaScript(
          `window.golfinho.request({action:'snapshot'}).then(s=>({projects:s.projects.length,agents:s.agents.map(a=>a.provider),title:document.title}))`,
        );
        if (process.env.GOLFINHO_SCREENSHOT) {
          await new Promise((r) => setTimeout(r, 400));
          const screenshot = await window.webContents.capturePage();
          await writeFile(process.env.GOLFINHO_SCREENSHOT, screenshot.toPNG());
        }
        console.log("GOLFINHO_SMOKE_OK", JSON.stringify({ ...result, integration }));
        window.close();
      }
    })
    .catch(async (error) => {
      console.error(error);
      await coordinator?.shutdown();
      if (!process.env.GOLFINHO_SMOKE) dialog.showErrorBox("Golfinho não iniciou", String(error));
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    if (shutdownDone) return;
    event.preventDefault();
    if (closing) return;
    if (window) {
      window.close();
      return;
    }
    closing = true;
    void (async () => {
      shells?.closeAll();
      chat?.stopAll();
      await coordinator?.shutdown();
      await Promise.allSettled([...requests]);
      logs?.flush();
      store?.close();
      shutdownDone = true;
      app.quit();
    })();
  });
  app.on("window-all-closed", () => app.quit());
}
