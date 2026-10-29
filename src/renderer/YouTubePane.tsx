import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  House,
  Maximize2,
  PictureInPicture2,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Square,
  X,
} from "lucide-react";
import type { YouTubeState } from "../shared/contracts";
export type YouTubeLayout = "tab" | "split" | "mini";
// A página do YouTube é uma view nativa por cima da janela, não um elemento do DOM.
// Este painel só reserva o espaço e informa ao processo principal onde desenhá-la.
// `paused` tira a página da frente enquanto o usuário arrasta algo por cima dela:
// a view nativa engoliria os eventos do mouse.
export function YouTubePane({
  layout,
  paused = false,
  onLayout,
  onClose,
  onBarPointerDown,
}: {
  layout: YouTubeLayout;
  paused?: boolean;
  onLayout: (layout: YouTubeLayout) => void;
  onClose: () => void;
  onBarPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<YouTubeState | null>(null);
  useEffect(() => window.golfinho.youtube.subscribe(setState), []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A view nativa fica acima de tudo: com um modal aberto ela sai da frente.
        if (paused || document.querySelector('[aria-modal="true"]')) return void window.golfinho.youtube.hide();
        const box = element.getBoundingClientRect();
        void window.golfinho.youtube.show({ x: box.left, y: box.top, width: box.width, height: box.height });
      });
    };
    const resize = new ResizeObserver(sync);
    resize.observe(element);
    resize.observe(document.body);
    const dialogs = new MutationObserver(sync);
    dialogs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      dialogs.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [paused]);
  // Sair da tela tira a página da frente; o vídeo continua tocando, como numa aba de navegador.
  useEffect(() => () => void window.golfinho.youtube.hide(), []);
  const go = (command: Parameters<typeof window.golfinho.youtube.command>[0]) =>
    void window.golfinho.youtube.command(command);
  return (
    <section className={"youtube-pane youtube-pane-" + layout}>
      <div className="youtube-bar" onPointerDown={onBarPointerDown}>
        <button aria-label="Voltar" title="Voltar" disabled={!state?.canGoBack} onClick={() => go("back")}>
          <ArrowLeft size={13} />
        </button>
        <button aria-label="Avançar" title="Avançar" disabled={!state?.canGoForward} onClick={() => go("forward")}>
          <ArrowRight size={13} />
        </button>
        <button aria-label="Recarregar" title="Recarregar" onClick={() => go("reload")}>
          <RotateCw size={13} />
        </button>
        <button aria-label="Início do YouTube" title="Início" onClick={() => go("home")}>
          <House size={13} />
        </button>
        <button
          className={state?.adblock ? "youtube-adblock on" : "youtube-adblock"}
          aria-label={state?.adblock ? "Desligar o bloqueador de anúncios" : "Ligar o bloqueador de anúncios"}
          aria-pressed={state?.adblock ?? false}
          title={state?.adblock ? "Bloqueador de anúncios ligado (clique para desligar)" : "Bloqueador de anúncios desligado (clique para ligar)"}
          disabled={!state}
          onClick={() => go("adblock")}
        >
          {state?.adblock ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
        </button>
        <span className="youtube-title" title={state?.url}>
          {state?.title || "YouTube"}
        </span>
        {layout !== "split" && (
          <button aria-label="Dividir com a tarefa" title="Dividir: YouTube ao lado da tarefa" onClick={() => onLayout("split")}>
            <Columns2 size={13} />
          </button>
        )}
        {layout !== "mini" && (
          <button aria-label="Mini player" title="Mini player flutuante" onClick={() => onLayout("mini")}>
            <PictureInPicture2 size={13} />
          </button>
        )}
        {layout !== "tab" && (
          <button aria-label="Abrir na aba" title="Abrir na aba YouTube" onClick={() => onLayout("tab")}>
            <Maximize2 size={12} />
          </button>
        )}
        {layout === "tab" ? (
          <button
            aria-label="Parar o YouTube"
            title="Parar: fecha a página e o áudio. Sair da aba mantém o vídeo tocando."
            onClick={() => {
              go("close");
              setState(null);
              // Reabre do início na próxima vez que o painel pedir espaço.
              requestAnimationFrame(() => {
                const box = host.current?.getBoundingClientRect();
                if (box) void window.golfinho.youtube.show({ x: box.left, y: box.top, width: box.width, height: box.height });
              });
            }}
          >
            <Square size={12} />
          </button>
        ) : (
          <button aria-label="Fechar o YouTube" title="Fechar: para o vídeo e o áudio" onClick={onClose}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="youtube-host" ref={host} />
    </section>
  );
}
type Box = { x: number; y: number; width: number; height: number };
const MINI_KEY = "golfinho.youtube.mini";
const MIN_W = 280;
const MIN_H = 180;
// Mantém o player inteiro dentro da janela, mesmo depois de ela encolher.
function fit(box: Box): Box {
  const width = Math.min(Math.max(MIN_W, box.width), window.innerWidth);
  const height = Math.min(Math.max(MIN_H, box.height), window.innerHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(0, box.x), window.innerWidth - width),
    y: Math.min(Math.max(0, box.y), window.innerHeight - height),
  };
}
function storedMini(): Box {
  try {
    const v = JSON.parse(localStorage.getItem(MINI_KEY) ?? "null");
    if (v && ["x", "y", "width", "height"].every((k) => typeof v[k] === "number")) return fit(v);
  } catch {
    /* preferência ilegível: usa o padrão */
  }
  return fit({ x: window.innerWidth - 440, y: window.innerHeight - 330, width: 420, height: 290 });
}
// Mini player: arrasta pela barra e redimensiona pelo canto. Fica por cima de qualquer visão.
export function YouTubeMini({ onLayout, onClose }: { onLayout: (layout: YouTubeLayout) => void; onClose: () => void }) {
  const [box, setBox] = useState(storedMini);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(MINI_KEY, JSON.stringify(box));
    } catch {
      /* sem armazenamento: a posição só não fica lembrada */
    }
  }, [box]);
  useEffect(() => {
    const refit = () => setBox((b) => fit(b));
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);
  function track(event: React.PointerEvent, apply: (dx: number, dy: number, start: Box) => Box) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = box;
    const x0 = event.clientX;
    const y0 = event.clientY;
    setMoving(true);
    const move = (e: PointerEvent) => setBox(fit(apply(e.clientX - x0, e.clientY - y0, start)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setMoving(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return (
    <div
      className={"youtube-mini" + (moving ? " moving" : "")}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <YouTubePane
        layout="mini"
        paused={moving}
        onLayout={onLayout}
        onClose={onClose}
        onBarPointerDown={(e) => {
          // Botões da barra continuam clicáveis; só o fundo dela arrasta.
          if ((e.target as HTMLElement).closest("button")) return;
          track(e, (dx, dy, s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
        }}
      />
      <div
        className="youtube-mini-grip"
        role="separator"
        aria-label="Redimensionar o mini player"
        onPointerDown={(e) => track(e, (dx, dy, s) => ({ ...s, width: s.width + dx, height: s.height + dy }))}
      />
    </div>
  );
}
