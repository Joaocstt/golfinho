import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, GitCommitHorizontal, Hand, Maximize2, MonitorPlay, Minimize2, PanelRightClose, PanelRightOpen, Pencil, X } from "lucide-react";
import type { Project, Request, Task } from "../shared/contracts";
import {
  officeAgent,
  type OfficeAgent,
  type OfficeAgentId,
  type OfficeDecision,
  type OfficeJob,
  type OfficeLayout,
  type OfficeState,
} from "../shared/office";
import {
  CELL,
  TEMPLATES,
  addDesk,
  boss,
  bossSpot,
  cellOf,
  center,
  deskFront,
  fits,
  itemAt,
  itemCells,
  moveItem,
  paint,
  placeFurniture,
  removeItem,
  type Cell,
  type ItemRef,
} from "../shared/officeLayout";
import {
  H,
  W,
  agentPath,
  collides,
  direction,
  interactionPoint,
  makeRoom,
  nearest,
  seatPoint,
  startPoint,
  step,
  targetAt,
  type Point,
  type Room,
  type Target,
} from "./officeGame";
import { drawBubble, drawDesk, drawEditorOverlay, drawFurniture, drawLabel, drawPerson, drawTiles } from "./officeDraw";
import { OfficeEditor, type Tool } from "./OfficeEditor";
import { OfficeScene, type AgentView } from "./office3d";
import { OfficeMonitor } from "./OfficeMonitor";
import { OfficeDeliveries, onDesk } from "./OfficeDeliveries";
import { useConfirm } from "./ui";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

type Modal = { kind: "agent"; id: OfficeAgentId } | { kind: "boss" } | { kind: "board" } | { kind: "telao" } | null;
type Guide = { to: OfficeAgentId; from: OfficeAgentId; text: string };

// Como cada agente aparece agora: andando com um papel, e o balão do momento.
interface Sprite {
  x: number;
  y: number;
  path: Point[];
  back: Point[];
  arrive: (() => void) | null;
  walking: boolean;
  carry: boolean;
  phase: number;
  bubble: { text: string; until: number } | null;
}

export function statusLabel(job: OfficeJob): string {
  if (job.status === "fila") return "na fila";
  if (job.status === "fazendo" && job.approval) return `${job.agentName} esperando sua aprovação`;
  if (job.status === "fazendo") return job.taskId ? `${job.agentName} executando a tarefa` : `${job.agentName} trabalhando`;
  if (job.status === "revisao") return job.activity || "em revisão";
  if (job.status === "entregue" && job.stage === "plano" && !job.approved) return "plano na sua mesa, esperando você";
  if (job.status === "entregue") return job.taskId ? (job.committed ? "commit feito" : "implementado, falta o commit") : "na sua mesa";
  return "deu erro";
}

// Escritório: a pessoa é o chefe, anda até a mesa de alguém e faz um pedido. A equipe trabalha
// no projeto escolhido no quadro da parede, e o resultado chega na mesa do chefe. No modo de
// edição, a mesma sala vira uma grade para pintar o chão, mover móveis e montar a equipe.
export function OfficePane({
  projects,
  tasks = [],
  initialProject,
  onOpenTask,
}: {
  projects: Project[];
  /** Tarefas do Golfinho, para o telão mostrar o status das que a equipe criou. */
  tasks?: Task[];
  initialProject: string;
  onOpenTask: (taskId: string) => void;
}) {
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState(
    () => projects.find((p) => p.id === initialProject)?.id ?? projects[0]?.id ?? "",
  );
  const [office, setOffice] = useState<OfficeState | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [arrival, setArrival] = useState<Guide | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<OfficeLayout | null>(null);
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [selected, setSelected] = useState<ItemRef | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const project = projects.find((p) => p.id === projectId);
  const canvas = useRef<HTMLCanvasElement>(null);
  const canvas3d = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  // Sem WebGL (ou nos testes), a sala é desenhada em 2D, vista de cima.
  const [has3d, setHas3d] = useState(false);
  const roomEl = useRef<HTMLDivElement>(null);
  const paneEl = useRef<HTMLElement>(null);
  // Tela cheia: o escritório ocupa o monitor; o painel lateral vira uma janela flutuante.
  const [fullscreen, setFullscreen] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(paneEl.current) && document.fullscreenElement === paneEl.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void paneEl.current?.requestFullscreen?.().catch(() => undefined);
    roomEl.current?.focus();
  }, []);
  const fullscreenRef = useRef(toggleFullscreen);
  fullscreenRef.current = toggleFullscreen;
  const log = useRef<HTMLDivElement>(null);
  const live = useRef({ office, modal, guide, editing, tool, selected, projectName: "" });
  live.current = { office, modal, guide, editing, tool, selected, projectName: project?.name ?? "" };

  useEffect(() => {
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);

  useEffect(() => {
    setOffice(null);
    setGuide(null);
    setEditing(null);
    setSelected(null);
    if (!projectId) return;
    let alive = true;
    request<OfficeState>({ action: "officeState", projectId })
      .then((s) => alive && setOffice((prev) => keepLayout(prev, s)))
      .catch((e) => alive && setError((e as Error).message));
    const dispose = window.golfinho.subscribe((s) => {
      if (s.kind === "office" && s.state.projectId === projectId) setOffice((prev) => keepLayout(prev, s.state));
    });
    return () => {
      alive = false;
      dispose();
    };
  }, [projectId]);

  const open = useCallback(
    (t: Target) => {
      setError("");
      if (t.kind === "agent") {
        setModal({ kind: "agent", id: t.agent.id });
        // Chegou na pessoa indicada: ela já sabe do que se trata, e a seta some.
        setArrival(guide?.to === t.agent.id ? guide : null);
        if (guide?.to === t.agent.id) setGuide(null);
      } else if (t.kind === "boss") {
        setModal({ kind: "boss" });
        if (projectId) void request({ action: "officeRead", projectId }).catch(() => undefined);
      } else if (t.kind === "telao") setModal({ kind: "telao" });
      else setModal({ kind: "board" });
    },
    [guide, projectId],
  );
  const openRef = useRef(open);
  openRef.current = open;

  // O editor muda a sala por aqui (o laço do canvas chama, por isso sem depender de estado velho).
  const edit = useRef({ setEditing, setSelected, removeAgent: async (_l: OfficeLayout, _id: string) => {} });
  edit.current = {
    setEditing,
    setSelected,
    removeAgent: async (l: OfficeLayout, id: string) => {
      const a = l.agents.find((x) => x.id === id);
      if (!a) return;
      const ok = await confirm({
        title: `Tirar ${a.name} da equipe?`,
        message: "A mesa sai da sala quando você salvar. Pedidos na fila dele deixam de ser feitos.",
        confirmLabel: "Tirar da equipe",
        tone: "danger",
      });
      if (!ok) return;
      setEditing((current) => (current ? removeItem(current, { type: "agent", id }) : current));
      setSelected(null);
    },
  };

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [office, modal]);

  async function send(text: string) {
    if (!project || modal?.kind !== "agent" || !text.trim()) return;
    const agentId = modal.id;
    setDraft("");
    setError("");
    try {
      const decision = await request<OfficeDecision>({ action: "officeAsk", projectId: project.id, agentId, text });
      if (decision.action === "encaminhar" && decision.to) setGuide({ to: decision.to, from: agentId, text });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!editing || !project) return;
    setSaving(true);
    setEditError("");
    try {
      const s = await request<OfficeState>({ action: "officeSaveLayout", projectId: project.id, layout: editing });
      setOffice((prev) => keepLayout(prev, s));
      setEditing(null);
      setSelected(null);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function applyTemplate(id: string) {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    const ok = await confirm({
      title: `Trocar a sala pelo modelo "${template.label}"?`,
      message: "A sala e a equipe em edição são substituídas. Nada é salvo até você clicar em Salvar escritório.",
      confirmLabel: "Usar o modelo",
    });
    if (!ok) return;
    setEditing(template.build());
    setSelected(null);
  }

  // ---------------- Jogo: chefe, agentes andando, desenho e editor ----------------
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d") ?? null;
    let scene: OfficeScene | null = null;
    try {
      if (canvas3d.current && overlay.current && typeof WebGLRenderingContext !== "undefined")
        scene = new OfficeScene(canvas3d.current, overlay.current);
    } catch {
      scene = null;
    }
    setHas3d(Boolean(scene));
    const keys = new Set<string>();
    let room: Room | null = null;
    let roomOf: OfficeLayout | null = null;
    const player = { x: 0, y: 0, placed: false, moving: false, phase: 0, goal: null as Point | null, goalTarget: null as Target | null };
    const sprites = new Map<OfficeAgentId, Sprite>();
    const sprite = (a: OfficeAgent): Sprite => {
      let s = sprites.get(a.id);
      if (!s) {
        s = { ...seatPoint(a), path: [], back: [], arrive: null, walking: false, carry: false, phase: Math.random() * 6, bubble: null };
        sprites.set(a.id, s);
      }
      return s;
    };
    const say = (a: OfficeAgent, text: string, ms = 3000) => {
      sprite(a).bubble = { text, until: performance.now() + ms };
    };
    const walk = (a: OfficeAgent, to: Cell, onArrive: () => void) => {
      if (!room) return onArrive();
      const path = agentPath(room, a, to);
      if (!path) return onArrive();
      const s = sprite(a);
      Object.assign(s, seatPoint(a), { path: path.go, back: path.back, walking: true, carry: true, arrive: onArrive });
    };
    // Mudança de etapa de um trabalho vira animação: levar para revisão, entregar na mesa.
    const seen = new Map<string, OfficeJob["status"]>();
    for (const job of live.current.office?.jobs ?? []) seen.set(job.id, job.status);
    const watch = (state: OfficeState) => {
      const reviewer = state.layout.reviewer ? officeAgent(state.layout, state.layout.reviewer) : undefined;
      for (const job of state.jobs) {
        const before = seen.get(job.id);
        seen.set(job.id, job.status);
        if (!before || before === job.status) continue;
        const owner = officeAgent(state.layout, job.agentId);
        if (!owner) continue;
        if (job.status === "revisao" && reviewer && reviewer.id !== owner.id) {
          say(owner, `Pronto! Levando pra ${reviewer.name} 📄`, 2000);
          walk(owner, deskFront(reviewer), () => say(owner, `${reviewer.name}, revisa pra mim?`));
        } else if (job.status === "entregue") {
          const courier = reviewer && before === "revisao" ? reviewer : owner;
          say(courier, before === "revisao" ? "Aprovado! ✅" : "Pronto! 📄", 2000);
          const desk = boss(state.layout);
          if (desk) walk(courier, bossSpot(desk), () => say(courier, "Deixei na sua mesa, chefe! 📄"));
        } else if (job.status === "erro") say(owner, "Deu problema 😕", 4000);
        else if (job.status === "fazendo") say(owner, "Trabalhando... ⚙️", 2000);
      }
    };
    const busyWith = (a: OfficeAgent, state: OfficeState) =>
      state.jobs.find(
        (j) =>
          (j.agentId === a.id && j.status === "fazendo") ||
          (a.id === state.layout.reviewer && j.status === "revisao" && j.activity.startsWith(a.name)),
      );

    // Balão do agente: a fala do momento, pensando, ou a ferramenta em uso.
    const bubbleText = (a: OfficeAgent, state: OfficeState | null, now: number) => {
      const s = sprite(a);
      const job = state ? busyWith(a, state) : undefined;
      return s.bubble && s.bubble.until > now
        ? s.bubble.text
        : state?.thinking.includes(a.id)
          ? "🤔 ..."
          : job && !s.walking
            ? job.approval
              ? `✋ Chefe, posso? ${job.approval.text}`
              : job.speech
              ? `💬 ${job.speech}`
              : `⚙️ ${(job.activity || job.title).replace(`${a.name}: `, "")}`
            : "";
    };
    const promptText = (state: OfficeState | null) => {
      if (!room || live.current.modal) return "";
      const near = nearest(room, player);
      const done = state?.jobs.filter((j) => j.status === "entregue" || j.status === "erro").length ?? 0;
      return !near
        ? ""
        : near.kind === "boss"
          ? `[E] Ver entregas (${done})`
          : near.kind === "board"
            ? "[E] Quadro do projeto"
            : near.kind === "telao"
              ? "[E] Ver o telão"
              : `[E] Falar com ${near.agent.name}`;
    };
    // Linhas do telão: o que cada um está fazendo agora, e os totais.
    const monitorRows = (layout: OfficeLayout, state: OfficeState | null) => {
      const jobs = state?.jobs ?? [];
      const n = (st: string) => jobs.filter((j) => j.status === st).length;
      return {
        rows: layout.agents.map((a) => {
          const job = state ? busyWith(a, state) : undefined;
          const queued = jobs.filter((j) => j.agentId === a.id && j.status === "fila").length;
          const thinking = state?.thinking.includes(a.id);
          return {
            name: a.name,
            color: a.color,
            busy: Boolean(job || thinking),
            text: job
              ? job.speech || (job.activity || job.title).replace(a.name + ": ", "")
              : thinking
                ? "pensando numa resposta"
                : queued
                  ? queued + " na fila"
                  : "livre",
          };
        }),
        totals: [
          n("fazendo") + " trabalhando",
          n("fila") + " na fila",
          n("revisao") + " em revisão",
          n("entregue") + " entregues",
          jobs.filter((j) => j.taskId).length + " tarefas criadas",
        ].join(" · "),
      };
    };
    const draw3d = (t: number, dt: number) => {
      if (!scene || !room) return;
      const { office: state, guide: hint } = live.current;
      const layout = room.layout;
      scene.setLayout(layout, live.current.projectName);
      const now = performance.now();
      const done = state?.jobs.filter((j) => j.status === "entregue" || j.status === "erro") ?? [];
      const agents: AgentView[] = layout.agents.map((a) => {
        const s = sprite(a);
        const job = state ? busyWith(a, state) : undefined;
        return {
          agent: a,
          x: s.x,
          y: s.y,
          walking: s.walking,
          carry: s.carry,
          phase: s.phase,
          screen: job ? "work" : state?.thinking.includes(a.id) ? "think" : "off",
          queued: state?.jobs.filter((j) => j.agentId === a.id && j.status === "fila").length ?? 0,
          bubble: bubbleText(a, state, now),
        };
      });
      scene.render({
        t,
        dt,
        player: { x: player.x, y: player.y, moving: player.moving, phase: player.phase },
        agents,
        delivered: done.length,
        unread: done.filter((j) => !j.read).length,
        guide: (hint && officeAgent(layout, hint.to)) || null,
        prompt: promptText(state),
        monitor: monitorRows(layout, state),
      });
    };

    const draw = (t: number) => {
      if (!ctx || !room) return;
      const { office: state, modal: open, guide: hint, editing: draftLayout, tool: activeTool, selected: pick } = live.current;
      const layout = room.layout;
      drawTiles(ctx, layout);
      const done = state?.jobs.filter((j) => j.status === "entregue" || j.status === "erro") ?? [];
      const unread = done.filter((j) => !j.read).length;
      // O quadro fica na parede; o resto, por linha, para quem está embaixo ficar na frente.
      const furniture = [...layout.furniture].sort((a, b) => a.row - b.row);
      for (const f of furniture) if (f.kind === "quadro") drawFurniture(ctx, f, { project: live.current.projectName, delivered: done.length, unread, t, summary: monitorRows(layout, state).totals.split(" · ").slice(0, 2).join(" · ") });
      for (const f of furniture) if (f.kind !== "quadro") drawFurniture(ctx, f, { project: live.current.projectName, delivered: done.length, unread, t, summary: monitorRows(layout, state).totals.split(" · ").slice(0, 2).join(" · ") });
      for (const a of layout.agents) {
        const s = sprite(a);
        const job = !draftLayout && state ? busyWith(a, state) : undefined;
        drawDesk(
          ctx,
          a,
          {
            seated: draftLayout ? true : !s.walking,
            screen: job ? "work" : state?.thinking.includes(a.id) && !draftLayout ? "think" : "off",
            queued: draftLayout ? 0 : state?.jobs.filter((j) => j.agentId === a.id && j.status === "fila").length ?? 0,
            phase: s.phase,
          },
          t,
        );
      }
      if (draftLayout) {
        drawEditorOverlay(ctx, {
          ghost: ghost.current,
          selected: pick ? itemCells(draftLayout, pick) : [],
        });
        return;
      }
      // Guia até quem cuida do pedido encaminhado.
      const target = hint && officeAgent(layout, hint.to);
      if (target) {
        const q = center(deskFront(target));
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -t * 40;
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const seat = seatPoint(target);
        const ay = seat.y - 74 + Math.sin(t * 6) * 6;
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.moveTo(seat.x - 12, ay);
        ctx.lineTo(seat.x + 12, ay);
        ctx.lineTo(seat.x, ay + 16);
        ctx.fill();
      }
      // Quem anda e o chefe, de trás para a frente.
      const movers: { y: number; draw: () => void }[] = layout.agents
        .filter((a) => sprite(a).walking)
        .map((a) => {
          const s = sprite(a);
          return { y: s.y, draw: () => drawPerson(ctx, s.x, s.y, a.color, a.hair, { moving: true, phase: s.phase * 10, carry: s.carry }) };
        });
      movers.push({
        y: player.y,
        draw: () => {
          drawPerson(ctx, player.x, player.y, "#22223b", "#3b2a1a", { moving: player.moving, phase: player.phase, tie: true });
          ctx.font = "bold 11px system-ui";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffd166";
          ctx.fillText("CHEFE", player.x, player.y - 52);
        },
      });
      movers.sort((a, b) => a.y - b.y).forEach((m) => m.draw());
      // Balões: pensando, a ferramenta em uso, ou a fala do momento.
      const now = performance.now();
      for (const a of layout.agents) {
        const s = sprite(a);
        const at = s.walking ? { x: s.x, y: s.y } : seatPoint(a);
        const job = state ? busyWith(a, state) : undefined;
        const text =
          s.bubble && s.bubble.until > now
            ? s.bubble.text
            : state?.thinking.includes(a.id)
              ? "🤔 ..."
              : job && !s.walking
                ? `⚙️ ${(job.activity || job.title).replace(`${a.name}: `, "")}`
                : "";
        if (text) drawBubble(ctx, at.x, at.y - 54, text);
      }
      const near = !open && nearest(room, player);
      if (near)
        drawLabel(
          ctx,
          player.x,
          player.y + 10,
          near.kind === "boss" ? `[E] Ver entregas (${done.length})` : near.kind === "board" ? "[E] Quadro do projeto" : near.kind === "telao" ? "[E] Ver o telão" : `[E] Falar com ${near.agent.name}`,
        );
      void activeTool;
    };

    let last = performance.now();
    let frame = 0;
    let frames = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { office: state, editing: draftLayout, modal: open } = live.current;
      const layout = draftLayout ?? state?.layout ?? null;
      if (layout && layout !== roomOf) {
        room = makeRoom(layout);
        roomOf = layout;
        // Sala nova (salva ou trocada): o chefe volta para o lugar dele se ficou preso, e quem
        // estava andando volta para a cadeira.
        if (!player.placed || collides(room, player)) {
          Object.assign(player, startPoint(room), { placed: true, goal: null, goalTarget: null });
        }
        for (const a of layout.agents) {
          const s = sprite(a);
          if (!s.walking) Object.assign(s, seatPoint(a));
        }
      }
      if (state && !draftLayout) watch(state);
      if (room && !open && !draftLayout) {
        let vx = 0, vy = 0;
        if (keys.has("arrowleft") || keys.has("a")) vx--;
        if (keys.has("arrowright") || keys.has("d")) vx++;
        if (keys.has("arrowup") || keys.has("w")) vy--;
        if (keys.has("arrowdown") || keys.has("s")) vy++;
        // Em 3D, W anda para onde a câmera olha e A/D para os lados dela.
        if (scene && (vx || vy)) {
          const { forward, right } = scene.basis();
          const f = -vy, side = vx;
          vx = forward.x * f + right.x * side;
          vy = forward.y * f + right.y * side;
        }
        if (vx || vy) player.goal = null;
        else if (player.goal) {
          const dx = player.goal.x - player.x, dy = player.goal.y - player.y, d = Math.hypot(dx, dy);
          if (d < 6) {
            const target = player.goalTarget;
            player.goal = null;
            player.goalTarget = null;
            if (target) openRef.current(target);
          } else {
            vx = dx / d;
            vy = dy / d;
          }
        }
        const l = Math.hypot(vx, vy) || 1;
        const next = step(room, player, (vx / l) * 200 * dt, (vy / l) * 200 * dt);
        player.moving = next.x !== player.x || next.y !== player.y;
        if ((vx || vy) && !player.moving) player.goal = player.goalTarget = null;
        player.x = next.x;
        player.y = next.y;
        if (player.moving) player.phase += dt * 10;
      } else player.moving = false;
      for (const s of sprites.values()) {
        s.phase += dt;
        if (!s.walking) continue;
        const to = s.path[0];
        if (!to) {
          s.walking = false;
          continue;
        }
        const dx = to.x - s.x, dy = to.y - s.y, d = Math.hypot(dx, dy), sp = 140 * dt;
        if (d > sp) {
          s.x += (dx / d) * sp;
          s.y += (dy / d) * sp;
          continue;
        }
        s.x = to.x;
        s.y = to.y;
        s.path.shift();
        if (s.path.length) continue;
        if (s.arrive) {
          const arrive = s.arrive;
          s.arrive = null;
          arrive();
          s.carry = false;
          s.path = s.back;
          s.back = [];
        } else s.walking = false;
      }
      // Com uma janela aberta por cima, a sala atrás dela anda a ~15 quadros por segundo.
      frames++;
      if (scene && !draftLayout) {
        if (!open || frames % 4 === 0) draw3d(now / 1000, open ? dt * 4 : dt);
      } else draw(now / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // ---- Teclado e mouse ----
    const el = roomEl.current;
    const cv = canvas.current;
    const pointAt = (e: MouseEvent): Point => {
      const r = cv!.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    };
    const down = (e: KeyboardEvent) => {
      const { modal: open, editing: draftLayout, selected: pick } = live.current;
      if (open) return;
      const k = e.key.toLowerCase();
      if (draftLayout) {
        if ((k === "delete" || k === "backspace") && pick) {
          e.preventDefault();
          if (pick.type === "agent") void edit.current.removeAgent(draftLayout, pick.id);
          else {
            edit.current.setEditing(removeItem(draftLayout, pick));
            edit.current.setSelected(null);
          }
        } else if (k === "escape") edit.current.setSelected(null);
        return;
      }
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      if (k === "f") {
        fullscreenRef.current();
        return;
      }
      keys.add(k);
      if (k === "e" && room) {
        const t = nearest(room, player);
        if (t) {
          keys.clear();
          openRef.current(t);
        }
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();

    // Editor: pintar arrastando, colocar com um clique, mover arrastando.
    let painting = false;
    let dragging: { ref: ItemRef; offset: Cell; kind: "mesa" | OfficeLayout["furniture"][number]["kind"]; moved: boolean } | null = null;
    const editAt = (e: MouseEvent, phase: "down" | "move" | "up") => {
      const draftLayout = live.current.editing;
      if (!draftLayout) return false;
      const cell = cellOf(pointAt(e));
      const t = live.current.tool;
      if (t.kind === "tile") {
        if (phase === "down") painting = true;
        if (phase === "up") painting = false;
        ghost.current = { cell, kind: "tile", ok: true };
        if (painting) edit.current.setEditing((l) => (l ? paint(l, cell, t.tile) : l));
        return true;
      }
      if (t.kind === "furniture" || t.kind === "desk") {
        const kind = t.kind === "desk" ? "mesa" : t.furniture;
        ghost.current = { cell, kind, ok: fits(draftLayout, kind, cell, singletonRef(draftLayout, kind)) };
        if (phase === "down") {
          if (t.kind === "desk") {
            const added = addDesk(draftLayout, cell);
            if (added) {
              edit.current.setEditing(added.layout);
              edit.current.setSelected({ type: "agent", id: added.id });
              setTool({ kind: "select" });
            }
          } else {
            const placed = placeFurniture(draftLayout, t.furniture, cell, `${t.furniture}-${Date.now().toString(36)}`);
            if (placed) edit.current.setEditing(placed);
          }
        }
        return true;
      }
      if (t.kind === "erase") {
        ghost.current = null;
        if (phase === "down") {
          const ref = itemAt(draftLayout, cell);
          if (ref?.type === "agent") void edit.current.removeAgent(draftLayout, ref.id);
          else if (ref) edit.current.setEditing(removeItem(draftLayout, ref));
        }
        return true;
      }
      // Selecionar e mover.
      if (phase === "down") {
        const ref = itemAt(draftLayout, cell);
        edit.current.setSelected(ref);
        if (ref) {
          const origin = itemCells(draftLayout, ref)[0];
          const kind = ref.type === "agent" ? "mesa" : draftLayout.furniture.find((f) => f.id === ref.id)!.kind;
          dragging = { ref, offset: { col: cell.col - origin.col, row: cell.row - origin.row }, kind, moved: false };
        }
      } else if (dragging) {
        const at = { col: cell.col - dragging.offset.col, row: cell.row - dragging.offset.row };
        const origin = itemCells(draftLayout, dragging.ref)[0];
        if (origin && (at.col !== origin.col || at.row !== origin.row)) dragging.moved = true;
        ghost.current = dragging.moved ? { cell: at, kind: dragging.kind, ok: fits(draftLayout, dragging.kind, at, dragging.ref) } : null;
        if (phase === "up") {
          if (dragging.moved) {
            const moved = moveItem(draftLayout, dragging.ref, at);
            if (moved) edit.current.setEditing(moved);
          }
          dragging = null;
          ghost.current = null;
        }
      } else ghost.current = null;
      return true;
    };
    const mouseDown = (e: MouseEvent) => {
      el?.focus();
      if (live.current.modal) return;
      if (editAt(e, "down")) return;
      if (!room) return;
      const p = pointAt(e);
      const t = targetAt(room, p);
      if (t) {
        const q = interactionPoint(room, t);
        if (Math.hypot(player.x - q.x, player.y - q.y) < 36) openRef.current(t);
        else {
          player.goal = { ...q };
          player.goalTarget = t;
        }
      } else {
        player.goal = p;
        player.goalTarget = null;
      }
    };
    const mouseMove = (e: MouseEvent) => void editAt(e, "move");
    const mouseUp = (e: MouseEvent) => void editAt(e, "up");
    const mouseLeave = () => {
      ghost.current = null;
      painting = false;
    };
    // 3D: arrastar gira a câmera, a roda aproxima, e um clique sem arrastar escolhe a mesa ou o chão.
    const cv3 = canvas3d.current;
    let orbit: { x: number; y: number; moved: boolean } | null = null;
    const down3 = (e: MouseEvent) => {
      el?.focus();
      if (live.current.modal) return;
      orbit = { x: e.clientX, y: e.clientY, moved: false };
    };
    const move3 = (e: MouseEvent) => {
      if (!orbit || !scene) return;
      const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
      if (!orbit.moved && Math.hypot(dx, dy) < 4) return;
      orbit.moved = true;
      scene.orbit(dx, dy);
      orbit.x = e.clientX;
      orbit.y = e.clientY;
    };
    const up3 = (e: MouseEvent) => {
      const was = orbit;
      orbit = null;
      if (!was || was.moved || !scene || !room || live.current.modal || live.current.editing) return;
      const hit = scene.pick(e.clientX, e.clientY);
      const layout = room.layout;
      const t: Target | null = !hit.target
        ? null
        : hit.target.kind === "agent"
          ? ((a) => (a ? { kind: "agent" as const, agent: a } : null))(officeAgent(layout, (hit.target as { id: string }).id))
          : hit.target;
      if (t) {
        const q = interactionPoint(room, t);
        if (Math.hypot(player.x - q.x, player.y - q.y) < 36) openRef.current(t);
        else {
          player.goal = { ...q };
          player.goalTarget = t;
        }
      } else if (hit.floor) {
        player.goal = hit.floor;
        player.goalTarget = null;
      }
    };
    const wheel3 = (e: WheelEvent) => {
      if (!scene) return;
      e.preventDefault();
      scene.zoom(e.deltaY);
    };
    cv3?.addEventListener("mousedown", down3);
    window.addEventListener("mousemove", move3);
    window.addEventListener("mouseup", up3);
    cv3?.addEventListener("wheel", wheel3, { passive: false });
    el?.addEventListener("keydown", down);
    el?.addEventListener("keyup", up);
    el?.addEventListener("blur", blur);
    cv?.addEventListener("mousedown", mouseDown);
    cv?.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", mouseUp);
    cv?.addEventListener("mouseleave", mouseLeave);
    return () => {
      cancelAnimationFrame(frame);
      cv3?.removeEventListener("mousedown", down3);
      window.removeEventListener("mousemove", move3);
      window.removeEventListener("mouseup", up3);
      cv3?.removeEventListener("wheel", wheel3);
      scene?.dispose();
      el?.removeEventListener("keydown", down);
      el?.removeEventListener("keyup", up);
      el?.removeEventListener("blur", blur);
      cv?.removeEventListener("mousedown", mouseDown);
      cv?.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("mouseup", mouseUp);
      cv?.removeEventListener("mouseleave", mouseLeave);
    };
    // O laço lê o estado por `live`; recomeçar só quando muda o projeto.
  }, [projectId]);
  const ghost = useRef<{ cell: Cell; kind: "tile" | "mesa" | OfficeLayout["furniture"][number]["kind"]; ok: boolean } | null>(null);

  useEffect(() => {
    if (!modal) roomEl.current?.focus();
  }, [modal]);

  if (!projects.length)
    return (
      <section className="office-pane office-empty">
        <h1>Escritório</h1>
        <p>Adicione um projeto ao Golfinho para a equipe ter onde trabalhar.</p>
      </section>
    );

  const layout = office?.layout;
  const agent = modal?.kind === "agent" && layout ? officeAgent(layout, modal.id) : undefined;
  const chat = agent ? office?.chats[agent.id] ?? [] : [];
  const thinking = agent ? office?.thinking.includes(agent.id) ?? false : false;
  const delivered = office ? onDesk(office.jobs) : [];
  const sender = arrival && agent && arrival.to === agent.id && layout ? officeAgent(layout, arrival.from) : undefined;
  const greeting = !agent
    ? ""
    : sender
      ? `Oi, chefe! ${sender.article === "a" ? "A" : "O"} ${sender.name} disse que você vinha. É sobre "${arrival!.text}"? Pode mandar.`
      : `Oi, chefe! Eu cuido de ${agent.area}. O que você precisa?`;
  const guideTo = guide && layout ? officeAgent(layout, guide.to) : undefined;
  const guideFrom = guide && layout ? officeAgent(layout, guide.from) : undefined;

  return (
    <section className={`office-pane${fullscreen ? " fullscreen" : ""}`} ref={paneEl}>
      <div
        className={`office-room${editing ? " editing" : ""}`}
        ref={roomEl}
        tabIndex={0}
        aria-label={
          editing
            ? "Editor do escritório: clique e arraste para montar a sala"
            : "Escritório: ande com WASD ou setas e aperte E perto de uma mesa"
        }
      >
        {!editing && (
          <div className="office-toolbar">
            {fullscreen && (
              <button
                type="button"
                onClick={() => setSideOpen((v) => !v)}
                title={sideOpen ? "Esconder o painel" : "Mostrar o painel"}
                aria-label={sideOpen ? "Esconder o painel" : "Mostrar o painel"}
              >
                {sideOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              title={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}
              aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        )}
        {!editing && office && (
          <ApprovalBar
            jobs={office.jobs}
            onDecide={(jobId, behavior, always) =>
              void request({ action: "officeDecide", projectId: office.projectId, jobId, behavior, always }).catch((e) =>
                setError((e as Error).message),
              )
            }
          />
        )}
        <canvas ref={canvas} width={W} height={H} hidden={has3d && !editing} />
        <div className="office-3d" hidden={!has3d || Boolean(editing)}>
          <canvas ref={canvas3d} />
          <div className="office-3d-labels" ref={overlay} />
        </div>
      </div>
      <aside className="office-side" hidden={fullscreen && !sideOpen}>
        {editing ? (
          <OfficeEditor
            layout={editing}
            tool={tool}
            onTool={setTool}
            selected={selected}
            onSelect={setSelected}
            onChange={setEditing}
            onTemplate={(id) => void applyTemplate(id)}
            onSave={() => void save()}
            onCancel={() => {
              setEditing(null);
              setSelected(null);
              setEditError("");
            }}
            saving={saving}
            error={editError}
          />
        ) : (
          <>
            <div className="office-help">
              <kbd>WASD</kbd>/<kbd>setas</kbd> andar · <kbd>E</kbd> falar · arraste para girar a câmera · <kbd>F</kbd> tela cheia.
            </div>
            <label className="office-project">
              Projeto
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projeto do Escritório">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="office-edit"
              disabled={!layout}
              onClick={() => {
                if (!layout) return;
                // As confirmações do editor aparecem fora do escritório: sai da tela cheia.
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                setModal(null);
                setGuide(null);
                setEditing(layout);
                setTool({ kind: "select" });
              }}
            >
              <Pencil size={12} /> Editar escritório
            </button>
            <button type="button" className="office-edit" disabled={!office} onClick={() => setModal({ kind: "telao" })}>
              <MonitorPlay size={12} /> Telão: tudo o que a equipe fez
            </button>
            <ul className="office-team" aria-label="Equipe">
              {layout?.agents.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => open({ kind: "agent", agent: a })}>
                    <i style={{ background: a.color }} />
                    {a.name} · {a.role}
                    {layout.reviewer === a.id && <small>revisa</small>}
                  </button>
                </li>
              ))}
            </ul>
            <h2>Trabalhos</h2>
            {office?.jobs.length ? (
              <ul className="office-jobs">
                {office.jobs.map((j) => (
                  <li key={j.id} className={`office-job ${j.status}`}>
                    <strong>{j.title}</strong>
                    <span>
                      {j.agentName} · {statusLabel(j)}
                    </span>
                    {j.status === "fazendo" && j.activity && <em>{j.activity}</em>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="office-muted">Nenhum pedido ainda. Vá até a mesa de alguém e peça algo sobre o projeto.</p>
            )}
          </>
        )}
      </aside>

      {modal && !editing && (
        <div className="office-modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <div
            className={`office-dialog${modal.kind === "telao" || modal.kind === "boss" ? " wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              agent ? `${agent.name} · ${agent.role}` : modal.kind === "boss" ? "Entregas" : modal.kind === "telao" ? "Telão" : "Quadro do projeto"
            }
            onKeyDown={(e) => e.key === "Escape" && setModal(null)}
          >
            <header>
              <span>
                {agent
                  ? `${agent.name} · ${agent.role}`
                  : modal.kind === "boss"
                    ? `Entregas na sua mesa (${delivered.length})`
                    : modal.kind === "telao"
                      ? "Telão · controle da equipe"
                      : "Quadro do projeto"}
              </span>
              <button type="button" aria-label="Fechar" onClick={() => setModal(null)}>
                <X size={14} />
              </button>
            </header>

            {agent && (
              <>
                <div className="office-log" ref={log}>
                  <p className="office-msg agente">
                    <b>{agent.name}</b>
                    {greeting}
                  </p>
                  {chat.map((m, i) => (
                    <p key={i} className={`office-msg ${m.who}`}>
                      {m.who !== "sistema" && <b>{m.who === "chefe" ? "Você" : agent.name}</b>}
                      {m.text}
                    </p>
                  ))}
                  {thinking && <p className="office-msg agente pensando">{agent.name} está pensando...</p>}
                  {office && (
                    <ApprovalBar
                      inline
                      jobs={office.jobs.filter((j) => j.agentId === agent.id)}
                      onDecide={(jobId, behavior, always) =>
                        void request({ action: "officeDecide", projectId: office.projectId, jobId, behavior, always }).catch((e) =>
                          setError((e as Error).message),
                        )
                      }
                    />
                  )}
                  {guideTo && guideFrom?.id === agent.id && (
                    <p className="office-msg sistema">
                      Vá até a mesa d{guideTo.article} {guideTo.name}, {direction(agent, guideTo)}. A seta mostra o caminho.
                    </p>
                  )}
                </div>
                {error && <p className="office-error">{error}</p>}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft);
                  }}
                >
                  <input
                    id="office-input"
                    autoFocus
                    value={draft}
                    disabled={thinking}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Peça algo para ${agent.article} ${agent.name}...`}
                    aria-label="Pedido"
                  />
                  <button type="submit" disabled={thinking || !draft.trim()}>
                    Enviar
                  </button>
                </form>
              </>
            )}

            {modal.kind === "boss" && office && (
              <OfficeDeliveries
                projectId={office.projectId}
                jobs={office.jobs}
                tasks={tasks}
                onOpenTask={(id) => {
                  setModal(null);
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                  onOpenTask(id);
                }}
              />
            )}

            {modal.kind === "telao" && office && (
              <div className="office-log">
                <OfficeMonitor
                  office={office}
                  tasks={tasks}
                  onOpenTask={(id) => {
                    setModal(null);
                    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                    onOpenTask(id);
                  }}
                />
              </div>
            )}

            {modal.kind === "board" && (
              <div className="office-log">
                <label className="office-project">
                  Projeto em que a equipe trabalha
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} autoFocus>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {project && <code className="office-path">{project.path}</code>}
                <p className="office-muted">
                  A equipe lê os arquivos desta pasta e recebe a memória do projeto. Ninguém altera nada: pedidos de
                  código viram uma tarefa do Golfinho em rascunho, que você revisa e coloca na fila. Cada projeto tem o
                  próprio escritório.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// Cada atualização chega como objeto novo. Se a sala não mudou, reaproveita o layout anterior:
// é ele que diz à cena 3D e à grade de colisão quando precisam ser refeitas.
function keepLayout(prev: OfficeState | null, next: OfficeState | null): OfficeState | null {
  if (!next) return prev;
  if (!prev || prev.projectId !== next.projectId || prev.layout === next.layout) return next;
  return JSON.stringify(prev.layout) === JSON.stringify(next.layout) ? { ...next, layout: prev.layout } : next;
}

const CHANGE_LABEL: Record<string, string> = { modified: "alterado", added: "novo", deleted: "apagado", untracked: "novo" };

// Pedidos de permissão dos agentes, por cima da sala: aprovar sem sair do Escritório.
function ApprovalBar({
  jobs,
  onDecide,
  inline = false,
}: {
  jobs: OfficeJob[];
  onDecide: (jobId: string, behavior: "allow" | "deny", always: boolean) => void;
  inline?: boolean;
}) {
  const waiting = jobs.filter((j) => j.approval && j.status === "fazendo");
  if (!waiting.length) return null;
  return (
    <div className={`office-approvals${inline ? " inline" : ""}`} role="alert">
      {waiting.map((j) => (
        <div key={j.id} className="office-approval">
          <Hand size={14} />
          <span>
            <b>{j.agentName}</b> pede: {j.approval!.text}
          </span>
          <button type="button" className="primary" onClick={() => onDecide(j.id, "allow", false)}>
            Permitir
          </button>
          {j.approval!.canAlways && (
            <button type="button" onClick={() => onDecide(j.id, "allow", true)}>
              Sempre
            </button>
          )}
          <button type="button" className="danger" onClick={() => onDecide(j.id, "deny", false)}>
            Negar
          </button>
        </div>
      ))}
    </div>
  );
}

const singletonRef = (l: OfficeLayout, kind: string): ItemRef | undefined => {
  const f = (kind === "chefe" || kind === "quadro") && l.furniture.find((x) => x.kind === kind);
  return f ? { type: "furniture", id: f.id } : undefined;
};
void CELL;
