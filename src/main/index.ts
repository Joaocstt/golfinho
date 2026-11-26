import { app, BrowserWindow, dialog, ipcMain, clipboard, nativeImage, Notification, protocol, shell, screen } from "electron";
import { ASSET_SCHEME, assetResponse } from "./officeAssets";
import { existsSync } from "node:fs";
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
import type { Signal, Task } from "../shared/contracts";
import { Shells } from "./shells";
import { ChatManager } from "./chat";
import { MemoryMcp } from "./memoryMcp";
import { SshMcp } from "./sshMcp";
import { ChatImages, IMAGE_EXTENSIONS } from "./chatImages";
import { vaultFrom } from "./vault";
import { configureAskpass, askpassFile } from "./ssh";
import { writeFileSync, chmodSync } from "node:fs";
import { safeStorage } from "electron";
import { exercise } from "./smoke";
import { writeFile } from "node:fs/promises";
import { startUpdater, type Updater } from "./updater";
import { pluginSchemePrivileges, setupPlugins } from "./plugins/electron";
import { YouTube } from "./youtube";
import { Office } from "./office";
import { prepareMemory } from "./memory";
import { isFolderProject } from "./workspace";
import { clipboardFiles, FILE_FORMATS } from "./files";
const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let updater: Updater | undefined;
let installPending = false;
let coordinator: Coordinator | undefined;
let store: Store | undefined;
let logs: TerminalLogs | undefined;
let shells: Shells | undefined;
let chat: ChatManager | undefined;
let office: Office | undefined;
let memoryMcp: MemoryMcp | null = null;
let sshMcp: SshMcp | null = null;
let closing = false;
let shutdownDone = false;
const requests = new Set<Promise<unknown>>();
if (process.env.GOLFINHO_DATA_DIR) app.setPath("userData", process.env.GOLFINHO_DATA_DIR);
// Antes de qualquer busca de CLI: o app precisa enxergar o PATH do usuário.
if (process.platform !== "win32") process.env.PATH = mergePath(process.env.PATH, readLoginPath());
// Modelos 3D do Escritório: o esquema precisa ser registrado antes do app ficar pronto.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  pluginSchemePrivileges,
]);
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
      // A pasta que existir: no instalador, ao lado do app; no desenvolvimento, a do projeto. (O
      // executável de desenvolvimento é renomeado, e aí o Electron se acha empacotado.)
      const officeAssets =
        [join(process.resourcesPath, "office-assets"), join(here, "../../resources/office-assets")].find((dir) => existsSync(dir)) ??
        join(process.resourcesPath, "office-assets");
      protocol.handle(ASSET_SCHEME, (request) => assetResponse(officeAssets, request.url));
      if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(icon);
      const home = app.getPath("userData");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const directory = join(home, "logs");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      store = new Store(join(home, "golfinho.sqlite"));
      const resumable = store.recover();
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
        if (event.type === "delta") return;
        // Fim de cada resposta do agente: o registro da tarefa na memória é atualizado.
        if (event.type === "status" && event.state === "idle") service.remember(taskId);
        // Tarefa executada pelo Escritório: o andamento vira falas e ações na sala.
        office?.onChat(taskId, event);
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
          title: "Selecionar a pasta do projeto",
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
        // Arquivos copiados no gerenciador de arquivos: cada sistema guarda a lista num formato.
        files: async () => {
          for (const item of await clipboard.read()) {
            for (const type of item.types) {
              if (!FILE_FORMATS.some((format) => type.toLowerCase().includes(format.toLowerCase()))) continue;
              const blob = (await item.getType(type)) as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
              const bytes = Buffer.from(await blob.arrayBuffer());
              const text = /filenamew/i.test(type) ? bytes.toString("utf16le") : bytes.toString("utf8");
              const found = clipboardFiles(type, text);
              if (found.length) return found;
            }
          }
          return [];
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
      // Servidor MCP de análise SSH (expõe apenas os servidores que o usuário liberou para IA).
      sshMcp = new SshMcp(
        store,
        join(home, "ssh-mcp"),
        (connectionId) => service.sshPassword(connectionId),
        (taskId, req) => chat!.requestApproval(taskId, req),
      );
      try {
        await sshMcp.start();
        service.useSshMcp(sshMcp);
      } catch (error) {
        console.error("SSH: servidor MCP não iniciou.", error);
        sshMcp = null;
      }
      service.useDesktop({ trash: (path) => shell.trashItem(path), reveal: (path) => shell.showItemInFolder(path) });
      // Escritório: a equipe de agentes trabalha no projeto escolhido. Quem pesquisa, escreve e
      // revisa só lê os arquivos; o agente de código executa o pedido numa tarefa do Golfinho, pelo
      // chat, numa branch nova ou numa existente (o chefe escolhe), com o chefe aprovando as alterações pelo Escritório.
      office = new Office({
        project: (id) => store!.project(id),
        memory: (projectId, text) =>
          store!.settings().memory?.enabled === false ? null : prepareMemory(store!, projectId, text, false).text,
        createTask: async (p, title, prompt, hint, provider, existing) => {
          const folder = isFolderProject(p);
          const slug =
            hint.toLowerCase().normalize("NFD").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) ||
            "pedido";
          const remotes = folder ? [] : (await git.inspect(p.path)).remotes;
          return (await service.request({
            action: "createTask",
            input: {
              projectId: p.id,
              title,
              prompt: prompt.slice(0, 16000),
              provider,
              // O chefe escolhe: branch existente (adotada, como no formulário de tarefa) ou uma nova.
              branch: folder ? "" : existing ?? `golfinho/escritorio-${slug}-${randomUUID().slice(0, 4)}`,
              base: folder ? "" : existing ?? (await git.current(p.path)),
              adopt: !folder && Boolean(existing),
              remote: remotes[0] ?? "",
              timeoutMinutes: 60,
            },
          })) as Task;
        },
        emit: (state) => signal({ kind: "office", state }),
        executable: (provider) => store!.settings().executables[provider],
        load: (projectId) => store!.office(projectId),
        save: (projectId, state) => store!.saveOffice(projectId, state),
        runTask: async (taskId, text) => {
          await coordinator!.startChatRun(taskId);
          try {
            await service.request({ action: "chatSend", taskId, text });
          } catch (error) {
            coordinator!.endChatRun(taskId, false, `Escritório: não consegui começar (${(error as Error).message}).`);
            throw error;
          }
        },
        endRun: (taskId, ok, message) => coordinator!.endChatRun(taskId, ok, message),
        changes: async (taskId) => (await service.request({ action: "changes", taskId })) as Record<string, string>,
        decide: async (taskId, id, behavior, always) => {
          await service.request({ action: "chatDecide", taskId, id, behavior, always });
        },
        commit: async (taskId, paths, message) => {
          await service.request({ action: "commitFiles", taskId, paths, message, push: false });
        },
        enabled: () => store!.settings().office?.enabled === true,
        task: (taskId) => {
          try {
            return store!.task(taskId);
          } catch {
            return null;
          }
        },
        interrupt: async (taskId) => {
          await service.request({ action: "chatInterrupt", taskId });
        },
        // Aviso do sistema só com a janela fora de foco: com ela à vista, o Escritório já mostra.
        notify: (title, body) => {
          if (!Notification.isSupported() || !window || window.isDestroyed() || window.isFocused()) return;
          const n = new Notification({ title, body, icon });
          n.on("click", () => {
            if (!window || window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
          });
          n.show();
        },
      });
      service.useOffice(office);
      coordinator.afterRun((taskId) => service.remember(taskId));
      // Tarefa iniciada fica iniciada: o que rodava quando o app fechou volta sozinho.
      for (const id of resumable) coordinator.queue(id);
      window = new BrowserWindow({
        // Limitada à área útil do monitor: com escala do Windows acima de 100%, 950 px lógicos
        // passam da tela e escondem a parte de baixo, onde fica o campo de digitação.
        width: Math.min(1400, screen.getPrimaryDisplay().workAreaSize.width),
        height: Math.min(950, screen.getPrimaryDisplay().workAreaSize.height),
        minWidth: 980,
        minHeight: 700,
        title: "Golfinho",
        icon,
        // A mesma cor da abertura do app: nada de flash de outra cor antes da página carregar.
        backgroundColor: "#0d0e12",
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
      // No desenvolvimento, avisos e erros da interface aparecem também no terminal.
      if (process.env.ELECTRON_RENDERER_URL)
        window.webContents.on("console-message", (event) => {
          const e = event as unknown as { level?: string; message?: string; sourceId?: string; lineNumber?: number };
          if (e.level === "warning" || e.level === "error")
            console.log(`[interface ${e.level}] ${e.message ?? ""} (${e.sourceId ?? ""}:${e.lineNumber ?? ""})`);
        });
      // Links da CLI abrem no navegador padrão; só http e https, nada de outros esquemas.
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      // Plugins no formato do ORCA: instalação, worker de cada um e os arquivos do editor.
      setupPlugins({
        here,
        root: join(home, "plugins"),
        vault: vaultFrom(safeStorage),
        store: () => store!,
        window: () => window,
        activeBranch: () => null,
        notify: (title, body) => new Notification({ title, body }).show(),
      });
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
      // Atualização: status vai para a janela; verificar, baixar e instalar são pedidos do usuário.
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
      // Verificar e baixar só acontecem quando o usuário clica.
      ipcMain.handle("golfinho:update:check", (event) => {
        if (trusted(event)) updater?.check();
      });
      ipcMain.handle("golfinho:update:download", (event) => {
        if (trusted(event)) updater?.download();
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
      office?.stop();
      await coordinator?.shutdown();
      await memoryMcp?.stop();
      await sshMcp?.stop();
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
