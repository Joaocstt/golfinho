import { BrowserWindow, WebContentsView, session, shell } from "electron";
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
export class YouTube {
  private view: WebContentsView | null = null;
  private bounds: YouTubeBounds | null = null;
  private shown = false;
  private fullscreen = false;
  constructor(
    private readonly window: BrowserWindow,
    private readonly emit: (state: YouTubeState) => void,
  ) {
    window.on("resize", () => this.layout());
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
    void contents.loadURL(HOME);
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
    // Fechar a aba para de verdade: some o áudio de fundo e libera a memória da página.
    if (command === "close") {
      this.hide();
      contents.close();
      this.view = null;
    }
  }
}
