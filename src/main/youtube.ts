import { BrowserWindow, WebContentsView, session, shell, type Session } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { YouTubeBounds, YouTubeCommand, YouTubeState } from "../shared/contracts";
const HOME = "https://www.youtube.com/";
// Só YouTube e o login do Google. Qualquer outro endereço vai para o navegador padrão:
// a aba não vira um navegador geral dentro do app.
export function allowedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    /(^|\.)youtube\.com$/.test(host) ||
    host === "youtu.be" ||
    /(^|\.)youtube-nocookie\.com$/.test(host) ||
    // Login: accounts.google.com e os domínios regionais por onde o Google passa (google.com.br).
    /(^|\.)google\.(com|[a-z]{2}|com?\.[a-z]{2})$/.test(host)
  );
}
// A página fica numa WebContentsView sobreposta à janela, sem preload e com sessão
// própria: nada do YouTube enxerga a API do Golfinho nem os cookies do app.
type Blocker = import("@ghostery/adblocker-electron").ElectronBlocker;
export class YouTube {
  private view: WebContentsView | null = null;
  // Bloqueador de anúncios (listas do uBlock/EasyList via Ghostery). Ligado por padrão;
  // a escolha fica em youtube.json e as listas, em cache, na pasta de dados do app.
  private adblock = true;
  private blocker: Promise<Blocker> | null = null;
  private readonly prefs: Promise<void>;
  private bounds: YouTubeBounds | null = null;
  private shown = false;
  private fullscreen = false;
  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (state: YouTubeState) => void,
    private readonly dataDir: string,
  ) {
    window.on("resize", () => this.layout());
    this.prefs = readFile(join(dataDir, "youtube.json"), "utf8")
      .then((text) => {
        const saved = JSON.parse(text) as { adblock?: unknown };
        if (typeof saved.adblock === "boolean") this.adblock = saved.adblock;
      })
      .catch(() => undefined);
  }
  private loadBlocker() {
    this.blocker ??= (async () => {
      const { ElectronBlocker } = await import("@ghostery/adblocker-electron");
      const path = join(this.dataDir, "adblock-engine.bin");
      return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path,
        read: (file) => readFile(file),
        write: (file, data) => writeFile(file, data),
      });
    })();
    // Sem rede na primeira vez: tenta de novo na próxima abertura.
    this.blocker.catch(() => (this.blocker = null));
    return this.blocker;
  }
  private async syncAdblock(partition: Session) {
    await this.prefs;
    try {
      const blocker = await this.loadBlocker();
      const on = blocker.isBlockingEnabled(partition);
      if (this.adblock && !on) blocker.enableBlockingInSession(partition);
      if (!this.adblock && on) blocker.disableBlockingInSession(partition);
    } catch {
      // Listas indisponíveis: o YouTube abre normalmente, só sem o bloqueio.
    }
  }
  private create() {
    const partition = session.fromPartition("persist:youtube");
    // Fullscreen do vídeo é o único pedido aceito; câmera, microfone, notificações etc. não.
    partition.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(permission === "fullscreen"),
    );
    const view = new WebContentsView({
      webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    view.setBackgroundColor("#0f0f0f");
    const contents = view.webContents;
    const external = (url: string) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    };
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedUrl(url)) void contents.loadURL(url);
      else external(url);
      return { action: "deny" };
    });
    const guard = (event: Electron.Event, url: string) => {
      if (allowedUrl(url)) return;
      event.preventDefault();
      external(url);
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    contents.on("enter-html-full-screen", () => {
      this.fullscreen = true;
      this.window.setFullScreen(true);
      this.layout();
    });
    contents.on("leave-html-full-screen", () => {
      this.fullscreen = false;
      this.window.setFullScreen(false);
      this.layout();
    });
    for (const name of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"] as const)
      contents.on(name as "did-stop-loading", () => this.publish());
    this.view = view;
    // Carrega a página só depois do bloqueador, para os primeiros anúncios não passarem.
    void this.syncAdblock(partition).finally(() => {
      if (!contents.isDestroyed()) void contents.loadURL(HOME);
    });
    return view;
  }
  private layout() {
    if (!this.view || !this.shown) return;
    if (this.fullscreen) {
      const [width, height] = this.window.getContentSize();
      this.view.setBounds({ x: 0, y: 0, width, height });
    } else if (this.bounds) this.view.setBounds(this.bounds);
  }
  private publish() {
    const contents = this.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    this.emit({
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      adblock: this.adblock,
    });
  }
  show(bounds: YouTubeBounds) {
    const view = this.view ?? this.create();
    // O painel mede em pixels CSS da página do Golfinho; com zoom (Ctrl +/-) eles
    // deixam de ser os pixels da janela que a view nativa usa.
    const zoom = this.window.webContents.getZoomFactor() || 1;
    this.bounds = {
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.max(0, Math.round(bounds.width * zoom)),
      height: Math.max(0, Math.round(bounds.height * zoom)),
    };
    if (!this.shown) {
      this.window.contentView.addChildView(view);
      this.shown = true;
    }
    this.layout();
    this.publish();
  }
  // Sair da aba só tira a página da frente: o vídeo continua tocando, como numa aba de navegador.
  hide() {
    if (!this.view || !this.shown) return;
    if (this.fullscreen) {
      this.fullscreen = false;
      this.window.setFullScreen(false);
    }
    this.window.contentView.removeChildView(this.view);
    this.shown = false;
  }
  command(command: YouTubeCommand) {
    const contents = this.view?.webContents;
    if (!contents) return;
    if (command === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (command === "forward" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    if (command === "reload") contents.reload();
    if (command === "home") void contents.loadURL(HOME);
    if (command === "adblock") {
      this.adblock = !this.adblock;
      void writeFile(join(this.dataDir, "youtube.json"), JSON.stringify({ adblock: this.adblock })).catch(() => undefined);
      void this.syncAdblock(contents.session).then(() => !contents.isDestroyed() && contents.reload());
      this.publish();
    }
    // Fechar a aba para de verdade: some o áudio de fundo e libera a memória da página.
    if (command === "close") {
      this.hide();
      contents.close();
      this.view = null;
    }
  }
}
