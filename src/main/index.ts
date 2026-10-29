import { app, BrowserWindow, dialog, ipcMain, clipboard, nativeImage, shell, screen } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergePath, readLoginPath } from "./loginPath";
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
import { MemoryMcp } from "./memoryMcp";
import { ChatImages, IMAGE_EXTENSIONS } from "./chatImages";
import { vaultFrom } from "./vault";
import { configureAskpass, askpassFile } from "./ssh";
import { writeFileSync, chmodSync } from "node:fs";
import { safeStorage } from "electron";
import { exercise } from "./smoke";
import { writeFile } from "node:fs/promises";
import { startUpdater, type Updater } from "./updater";
import { YouTube } from "./youtube";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let updater: Updater | undefined;
let installPending = false;
let coordinator: Coordinator | undefined;
let store: Store | undefined;
let logs: TerminalLogs | undefined;
let shells: Shells | undefined;
let chat: ChatManager | undefined;
let memoryMcp: MemoryMcp | null = null;
let closing = false;
let shutdownDone = false;
const requests = new Set<Promise<unknown>>();
if (process.env.GOLFINHO_DATA_DIR) app.setPath("userData", process.env.GOLFINHO_DATA_DIR);
// Antes de qualquer busca de CLI: o app precisa enxergar o PATH do usuário.
if (process.platform !== "win32") process.env.PATH = mergePath(process.env.PATH, readLoginPath());
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const icon = join(
        app.isPackaged ? join(process.resourcesPath, "branding") : join(here, "../../build"),
        "icon.png",
      );
      if (process.platform === "win32") app.setAppUserModelId("com.golfinho.app");
      if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(icon);
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
      chat = new ChatManager((taskId, seq, event) => {
        signal({ kind: "chat", taskId, seq, event });
        // Fim de cada resposta do agente: o registro da tarefa na memória é atualizado.
        if (event.type === "status" && event.state === "idle") service.remember(taskId);
      }, {
        append: (taskId, event) => store!.chatAppend(taskId, event),
        list: (taskId) => store!.chatEvents(taskId),
        sessionId: (taskId) => store!.task(taskId).chatSessionId ?? null,
        saveSessionId: (taskId, sessionId) => store!.setChatSession(taskId, sessionId),
      });
      // Servidor MCP da memória do projeto. Se não subir, as notas continuam indo no prompt.
      memoryMcp = new MemoryMcp(store, join(home, "mcp"), changed);
      try {
        await memoryMcp.start();
      } catch (error) {
        console.error("Memória: servidor MCP não iniciou.", error);
        memoryMcp = null;
      }
      coordinator.useMemory(memoryMcp);
      // O askpass não contém segredo: lê a senha da variável que o app passa só a esse processo.
      const script = askpassFile();
      const askpass = join(home, script.name);
      writeFileSync(askpass, script.content, { mode: 0o700 });
      chmodSync(askpass, 0o700);
      configureAskpass(askpass);
      // Anexos do chat ficam numa pasta do app; imagens coladas (pasta clipboard) também valem.
      const images = new ChatImages(join(home, "chat-images"), [join(home, "chat-images"), join(home, "clipboard")]);
      const chatImages = {
        pick: async () => {
          const result = await dialog.showOpenDialog(window!, {
            title: "Anexar imagens",
            properties: ["openFile", "multiSelections"],
            filters: [{ name: "Imagens", extensions: IMAGE_EXTENSIONS }],
          });
          if (result.canceled) return [];
          return Promise.all(result.filePaths.slice(0, 8).map((file) => images.import(file)));
        },
        import: (path: string) => images.import(path),
        verify: (path: string) => images.verify(path),
        dataUrl: (path: string) => images.dataUrl(path),
      };
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
        // O Electron 44 não tem mais clipboard.readImage: a imagem vem de clipboard.read() como
        // blob. nativeImage converte qualquer formato que o sistema entregar (TIFF do macOS, JPEG…)
        // para PNG.
        image: async () => {
          for (const item of await clipboard.read()) {
            const type = item.types.find((t) => t.startsWith("image/"));
            if (!type) continue;
            const blob = (await item.getType(type)) as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
            const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
            if (!image.isEmpty()) return image.toPNG();
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
      }, shells, vaultFrom(safeStorage), chat, chatImages);
      service.useMemory(memoryMcp);
      coordinator.afterRun((taskId) => service.remember(taskId));
      window = new BrowserWindow({
        // Limitada à área útil do monitor: com escala do Windows acima de 100%, 950 px lógicos
        // passam da tela e escondem a parte de baixo, onde fica o campo de digitação.
        width: Math.min(1400, screen.getPrimaryDisplay().workAreaSize.width),
        height: Math.min(950, screen.getPrimaryDisplay().workAreaSize.height),
        minWidth: 980,
        minHeight: 700,
        title: "Golfinho",
        icon,
        backgroundColor: "#0b1220",
        // No desenvolvimento, mostre a janela durante o carregamento para que falhas no
        // primeiro paint não deixem o app aberto em segundo plano sem nenhuma janela visível.
        show: Boolean(process.env.ELECTRON_RENDERER_URL),
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
      // Atualização: status vai para a janela e a instalação só começa com pedido explícito.
      updater = startUpdater((status) => {
        if (window && !window.isDestroyed()) window.webContents.send("golfinho:update", status);
      });
      const trusted = (event: Electron.IpcMainInvokeEvent) =>
        Boolean(window) &&
        event.sender === window!.webContents &&
        event.senderFrame === window!.webContents.mainFrame;
      ipcMain.handle("golfinho:update:status", (event) => {
        if (!trusted(event)) return { state: "unsupported" };
        return updater?.status() ?? { state: "unsupported" };
      });
      ipcMain.handle("golfinho:update:install", (event) => {
        if (!trusted(event) || updater?.status().state !== "ready") return;
        // Fecha pela mesma rota do usuário: o before-quit encerra as execuções antes de instalar.
        installPending = true;
        window?.close();
      });
      const youtube = new YouTube(window, (state) => {
        if (window && !window.isDestroyed()) window.webContents.send("golfinho:youtube", state);
      }, app.getPath("userData"));
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
      ipcMain.handle("golfinho:youtube:show", (event, bounds: unknown) => {
        if (!trusted(event) || !bounds || typeof bounds !== "object") return;
        const b = bounds as Record<string, unknown>;
        youtube.show({ x: number(b.x), y: number(b.y), width: number(b.width), height: number(b.height) });
      });
      ipcMain.handle("golfinho:youtube:hide", (event) => {
        if (trusted(event)) youtube.hide();
      });
      ipcMain.handle("golfinho:youtube:command", (event, command: unknown) => {
        if (!trusted(event)) return;
        if (command === "back" || command === "forward" || command === "reload" || command === "home" || command === "close" || command === "adblock")
          youtube.command(command);
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
      await memoryMcp?.stop();
      await Promise.allSettled([...requests]);
      logs?.flush();
      store?.close();
      shutdownDone = true;
      // Instalar a atualização precisa do app fechado; o instalador assume depois daqui.
      if (installPending) updater?.installNow();
      else app.quit();
    })();
  });
  app.on("window-all-closed", () => app.quit());
}
