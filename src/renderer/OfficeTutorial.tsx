import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Armchair, Bot, Briefcase, Cpu, FolderKanban, LayoutGrid, MessagesSquare, Plus, Trash2, Users, X } from "lucide-react";
import type { Project, Request, Settings } from "../shared/contracts";
import type { OfficeAgent, OfficeLayout, OfficeProvider } from "../shared/office";
import {
  FOOTPRINT,
  ROLE_PRESETS,
  TUTORIAL_MAX_AGENTS,
  agentIdFor,
  fits,
  freeDeskSpot,
  isWallTile,
  layoutProblems,
  tileAt,
  tutorialRoom,
  type Cell,
} from "../shared/officeLayout";
import { createEditor, type EditorHandle } from "./office3d/editor";
import { createDeskEditor, type DeskEditorHandle } from "./office3d/deskeditor";
import { agentDesk, agentLook } from "./office3d/officeLooks";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

type Stage = "boas" | "como" | "custo" | "usar" | "quem" | "visual" | "mesa" | "lugar" | "equipe" | "pronto";
const COLORS = ["#e07a5f", "#3d85c6", "#9b5de5", "#2a9d8f"];
const HAIRS = ["#5a3825", "#222222", "#c1440e", "#7a5230"];

// Tutorial de primeiro acesso ao Escritório, no mesmo pique do onboarding do Golfinho Call
// (GSAP: fundo com brilhos passeando, telas entrando de lado, letras pulando). Explica a sala,
// pergunta se a pessoa quer usar o Escritório e, se quiser, monta a equipe: cada agente com
// especialidade, personagem, mesa e lugar na sala (até 4 por enquanto).
export function OfficeTutorial({
  projects,
  initialProject,
  settings,
  onClose,
  team,
  onSaved,
  onRoomEditor,
}: {
  projects: Project[];
  initialProject: string;
  settings?: Settings;
  /** Fecha sem decidir (volta para onde estava). */
  onClose: () => void;
  /**
   * Só a montagem da equipe (o botão Editar do Escritório): começa em "Sua equipe" com a sala
   * atual do projeto e salva nela, sem o resto do tutorial.
   */
  team?: OfficeLayout;
  onSaved?: () => void;
  /** Abre o editor da sala (piso, paredes e móveis). */
  onRoomEditor?: (layout: OfficeLayout) => void;
}) {
  const editing = Boolean(team);
  const root = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const glowA = useRef<HTMLDivElement>(null);
  const glowB = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>(team ? "equipe" : "boas");
  const dir = useRef<1 | -1>(1);
  const [layout, setLayout] = useState<OfficeLayout>(() => team ?? tutorialRoom());
  const [current, setCurrent] = useState(0);
  const [projectId, setProjectId] = useState(() => projects.find((p) => p.id === initialProject)?.id ?? projects[0]?.id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const agent = layout.agents[current] as OfficeAgent | undefined;

  // Fundo vivo e entrada do tutorial.
  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to(glowA.current, { x: "18vw", y: "8vh", duration: 9, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.to(glowB.current, { x: "-14vw", y: "-10vh", duration: 11, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.from(root.current, { opacity: 0, duration: 0.5 });
    }, root);
    return () => ctx.revert();
  }, []);

  // Cada tela entra de lado (na direção em que se andou) e os itens marcados aparecem em sequência.
  useLayoutEffect(() => {
    const box = screen.current;
    if (!box) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(box, { opacity: 0, x: 50 * dir.current }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" });
      gsap.from(box.querySelectorAll(".ob-in"), { y: 18, opacity: 0, stagger: 0.08, duration: 0.45, delay: 0.1, ease: "power2.out" });
      const letters = box.querySelectorAll(".ob-letter");
      if (letters.length) gsap.from(letters, { y: 40, opacity: 0, rotation: 8, stagger: 0.045, duration: 0.5, ease: "back.out(2)", delay: 0.2 });
      const pop = box.querySelectorAll(".ob-pop");
      if (pop.length) gsap.from(pop, { scale: 0, rotation: -120, duration: 0.8, ease: "back.out(1.6)" });
      const cards = box.querySelectorAll(".ob-card, .ob-choice");
      if (cards.length) gsap.from(cards, { y: 30, rotationX: -25, opacity: 0, stagger: 0.12, duration: 0.6, ease: "power3.out", delay: 0.15 });
    }, box);
    return () => ctx.revert();
  }, [stage, current]);

  const go = (next: Stage, d: 1 | -1 = 1) => {
    setError("");
    dir.current = d;
    setStage(next);
  };

  async function saveSettings(office: Settings["office"]) {
    if (settings) await request({ action: "settings", settings: { ...settings, office } });
  }

  async function notNow() {
    setSaving(true);
    try {
      await saveSettings({ enabled: false, tutorial: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function finish() {
    const problems = layoutProblems(layout);
    if (problems.length) return setError(problems.join(" "));
    setSaving(true);
    setError("");
    try {
      await request({ action: "officeSaveLayout", projectId, layout });
      if (editing) return onSaved?.();
      await saveSettings({ enabled: true, tutorial: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const update = (patch: Partial<OfficeAgent>) =>
    setLayout((l) => ({ ...l, agents: l.agents.map((a, i) => (i === current ? { ...a, ...patch } : a)) }));

  const remove = (i: number) =>
    setLayout((l) => {
      const gone = l.agents[i];
      return { ...l, agents: l.agents.filter((_, k) => k !== i), reviewer: l.reviewer === gone?.id ? null : l.reviewer };
    });

  // Os passos do agente em edição: quem é → personagem → mesa → lugar.
  const order: Stage[] = ["boas", "como", "custo", "usar", "quem", "visual", "mesa", "lugar", "equipe", "pronto"];
  const back = () => {
    const i = order.indexOf(stage);
    if (stage === "quem" && (editing || (layout.agents.length > 1 && current > 0))) return go("equipe", -1);
    if (i > 0) go(order[i - 1], -1);
  };
  const steps = ["boas", "como", "custo", "usar", "equipe", "pronto"];
  const progress = ["quem", "visual", "mesa", "lugar"].includes(stage) ? 4 : steps.indexOf(stage) + 1;

  let body: React.ReactNode;
  let nextLabel: string | null = "Continuar";
  let onNext: () => void = () => go(order[order.indexOf(stage) + 1]);

  if (stage === "boas") {
    nextLabel = "Vamos lá";
    body = (
      <div className="ob-center">
        <div className="ob-logo ob-pop">
          <Briefcase size={64} />
        </div>
        <h1 className="ob-title">
          {"Bem-vindo ao Escritório".split("").map((ch, i) => (
            <span key={i} className="ob-letter">
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>
        <p className="ob-sub ob-in">Uma equipe de agentes em 3D trabalhando no seu projeto, e você é o chefe.</p>
        <p className="ob-hint ob-in">Leva um minutinho. Use os botões abaixo ou as setas do teclado.</p>
      </div>
    );
  } else if (stage === "como") {
    body = (
      <div className="ob-center">
        <span className="ob-kicker ob-in">Como funciona</span>
        <h2 className="ob-in">Você anda pela sala e faz pedidos</h2>
        <div className="ob-cards four">
          <Card icon={<Bot size={22} />} title="Cada agente tem uma especialidade">
            Pesquisa, código, design, textos, revisão. Você vai até a mesa de alguém e pede; se for de outra área, a pessoa
            indica o colega certo.
          </Card>
          <Card icon={<MessagesSquare size={22} />} title="Ligado ao chat do Golfinho">
            O que você pede no chat de uma tarefa aparece na sala: um agente senta e trabalha nela, com as falas e as ações.
          </Card>
          <Card icon={<Armchair size={22} />} title="Tudo passa pela sua mesa">
            Relatórios e planos chegam na mesa do chefe. Código só é feito quando você manda implementar.
          </Card>
          <Card icon={<FolderKanban size={22} />} title="Cada projeto tem o seu escritório">
            A equipe trabalha na pasta do projeto escolhido. Trocou de projeto, trocou de sala: cada um com a própria equipe,
            mesas e histórico.
          </Card>
        </div>
      </div>
    );
  } else if (stage === "custo") {
    body = (
      <div className="ob-split">
        <div className="ob-text">
          <span className="ob-kicker ob-in">Por baixo dos panos</span>
          <h2 className="ob-in">Tudo pelas CLIs que você já usa</h2>
          <ul className="ob-list">
            <li className="ob-in">Cada agente é um subagente do Claude Code ou da Codex, com a especialidade dele, chamado só quando tem trabalho.</li>
            <li className="ob-in">Não precisa de chave de API nem cobra à parte: usa a sua assinatura, como uma conversa normal na CLI.</li>
            <li className="ob-in">Parado, não gasta nada. Andar pela sala, as pausas e o espelho do chat são só animação.</li>
          </ul>
        </div>
        <div className="ob-diagram ob-in" aria-hidden="true">
          <div className="ob-node boss">Você</div>
          <div className="ob-wire" />
          <div className="ob-node">Escritório</div>
          <div className="ob-wire" />
          <div className="ob-row">
            <div className="ob-node cli">
              <Cpu size={14} /> Claude Code
            </div>
            <div className="ob-node cli">
              <Cpu size={14} /> Codex
            </div>
          </div>
        </div>
      </div>
    );
  } else if (stage === "usar") {
    nextLabel = null;
    body = (
      <div className="ob-center">
        <span className="ob-kicker ob-in">Sua escolha</span>
        <h2 className="ob-in">Quer usar o Escritório?</h2>
        <p className="ob-sub ob-in">Dá para mudar depois em Configurações.</p>
        <div className="ob-choices">
          <button
            type="button"
            className="ob-choice"
            onClick={() => {
              if (!layout.agents.length) startAgent();
              else go("equipe");
            }}
          >
            <span className="ob-choice-icon">
              <Users size={22} />
            </span>
            <strong>Usar o Escritório</strong>
            <span>Agora você monta a equipe: até 4 agentes, cada um com personagem, mesa e lugar.</span>
          </button>
          <button type="button" className="ob-choice" disabled={saving} onClick={() => void notNow()}>
            <span className="ob-choice-icon">
              <X size={22} />
            </span>
            <strong>Agora não</strong>
            <span>O Escritório fica desligado e não acompanha o chat. Ative quando quiser.</span>
          </button>
        </div>
      </div>
    );
  } else if (stage === "quem" && agent) {
    nextLabel = "Escolher o visual";
    onNext = () => {
      if (!agent.name.trim()) return setError("Dê um nome ao agente.");
      if (layout.agents.some((a, i) => i !== current && a.name.trim().toLowerCase() === agent.name.trim().toLowerCase()))
        return setError("Já tem alguém com esse nome na equipe.");
      go("visual");
    };
    const preset = ROLE_PRESETS.find((p) => p.base.area === agent.area && p.base.mode === agent.mode);
    body = (
      <div className="ob-split">
        <div className="ob-text">
          <span className="ob-kicker ob-in">
            Agente {current + 1} de até {TUTORIAL_MAX_AGENTS}
          </span>
          <h2 className="ob-in">Quem é?</h2>
          <label className="ob-field ob-in">
            Nome
            <input
              autoFocus
              value={agent.name}
              maxLength={30}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Ex.: Ana"
              aria-label="Nome do agente"
            />
          </label>
          <div className="ob-field ob-in">
            Tratamento
            <div className="ob-seg">
              {(["a", "o"] as const).map((v) => (
                <button key={v} type="button" className={agent.article === v ? "on" : ""} onClick={() => update({ article: v })}>
                  {v === "a" ? "a (ela)" : "o (ele)"}
                </button>
              ))}
            </div>
          </div>
          <div className="ob-field ob-in">
            Motor
            <div className="ob-seg">
              {(["claude", "codex"] as OfficeProvider[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={(agent.provider ?? "claude") === v ? "on" : ""}
                  onClick={() => update(v === "codex" ? { provider: v, model: "padrao" } : { provider: v })}
                >
                  {v === "claude" ? "Claude Code" : "Codex"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ob-roles ob-in" role="radiogroup" aria-label="Especialidade">
          {ROLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset?.id === p.id}
              className={"ob-role" + (preset?.id === p.id ? " on" : "")}
              onClick={() => {
                const { role, area, scope, personality, mode, web, model } = p.base;
                update({ role, area, scope, personality, mode, web, model: agent.provider === "codex" ? "padrao" : model });
                setLayout((l) => ({
                  ...l,
                  agents: l.agents.map((a, i) => (i === current ? { ...a, role, area, scope, personality, mode, web } : a)),
                  reviewer: p.id === "revisao" ? l.agents[current].id : l.reviewer === l.agents[current].id ? null : l.reviewer,
                }));
              }}
            >
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
    );
  } else if ((stage === "visual" || stage === "mesa") && agent) {
    nextLabel = stage === "visual" ? "Montar a mesa" : "Escolher o lugar";
    body = (
      <div className="ob-editor-step">
        <div className="ob-text">
          <span className="ob-kicker ob-in">
            {agent.name} · {stage === "visual" ? "personagem" : "mesa"}
          </span>
          <h2 className="ob-in">{stage === "visual" ? `Como ${agent.article === "a" ? "ela" : "ele"} é?` : "O setup da mesa"}</h2>
        </div>
        <CallEditor
          key={`${stage}:${agent.id}`}
          kind={stage === "visual" ? "personagem" : "mesa"}
          agent={agent}
          onValue={(value) => update(stage === "visual" ? { look: value } : { deskStyle: value })}
        />
      </div>
    );
  } else if (stage === "lugar" && agent) {
    nextLabel = "Pronto";
    body = (
      <div className="ob-editor-step">
        <div className="ob-text">
          <span className="ob-kicker ob-in">{agent.name} · lugar</span>
          <h2 className="ob-in">Onde fica a mesa?</h2>
          <p className="ob-sub ob-in">Clique na sala para mudar. A mesa ocupa 3 x 2 quadradinhos.</p>
        </div>
        <RoomPicker
          layout={layout}
          current={agent.id}
          onPick={(cell) => setLayout((l) => ({ ...l, agents: l.agents.map((a) => (a.id === agent.id ? { ...a, desk: cell } : a)) }))}
        />
      </div>
    );
  } else if (stage === "equipe") {
    nextLabel = layout.agents.length ? (editing ? (saving ? "Salvando..." : "Salvar a equipe") : "Terminar") : null;
    const projectName = projects.find((p) => p.id === projectId)?.name ?? "";
    body = (
      <div className="ob-center">
        <span className="ob-kicker ob-in">Sua equipe{projectName ? ` · ${projectName}` : ""}</span>
        <h2 className="ob-in">
          {layout.agents.length} de {Math.max(TUTORIAL_MAX_AGENTS, layout.agents.length)} agentes
        </h2>
        {editing && (
          <p className="ob-sub ob-in">
            Esta é a equipe do escritório deste projeto; cada projeto tem o seu. Clique num agente para mudar quem é, o
            personagem, a mesa ou o lugar.
          </p>
        )}
        <div className="ob-team">
          {layout.agents.map((a, i) => (
            <div key={a.id} className="ob-card ob-member">
              <span className="ob-avatar" style={{ background: a.color }}>
                {a.name.charAt(0)}
              </span>
              <strong>{a.name}</strong>
              <span>
                {a.role}
                {layout.reviewer === a.id ? " · revisa" : ""}
              </span>
              <div className="ob-member-actions">
                <button
                  type="button"
                  onClick={() => {
                    setCurrent(i);
                    go("quem");
                  }}
                >
                  Editar
                </button>
                <button type="button" aria-label={`Tirar ${a.name}`} onClick={() => remove(i)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          {layout.agents.length < TUTORIAL_MAX_AGENTS && (
            <button type="button" className="ob-card ob-add" onClick={startAgent}>
              <Plus size={26} />
              <strong>Adicionar agente</strong>
            </button>
          )}
        </div>
        {editing && onRoomEditor && (
          <button type="button" className="ob-room-link ob-in" onClick={() => onRoomEditor(layout)}>
            <LayoutGrid size={14} /> Editar a sala: piso, paredes e móveis
          </button>
        )}
      </div>
    );
  } else if (stage === "pronto") {
    nextLabel = null;
    body = (
      <div className="ob-center">
        <div className="ob-logo ob-pop">
          <Users size={60} />
        </div>
        <h2 className="ob-in">Tudo pronto!</h2>
        <p className="ob-sub ob-in">
          {layout.agents.map((a) => a.name).join(", ")} já estão nas mesas. Ande com WASD, chegue numa mesa e aperte E para pedir algo.
        </p>
        <p className="ob-hint ob-in">
          Cada projeto tem o seu escritório. Esta equipe fica no projeto abaixo; nos outros, você monta outra quando abrir.
        </p>
        {projects.length > 1 && (
          <label className="ob-field ob-in ob-project">
            Projeto em que a equipe começa
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="primary ob-go ob-in" disabled={saving} onClick={() => void finish()}>
          {saving ? "Abrindo..." : "Abrir o Escritório"}
        </button>
      </div>
    );
  }

  function startAgent() {
    setLayout((l) => {
      if (l.agents.length >= TUTORIAL_MAX_AGENTS) return l;
      const i = l.agents.length;
      const preset = ROLE_PRESETS[i % ROLE_PRESETS.length].base;
      const spot = freeDeskSpot(l) ?? { col: 0, row: 0 };
      const name = "";
      const fresh: OfficeAgent = {
        ...preset,
        id: agentIdFor(l, `agente-${i + 1}`),
        name,
        color: COLORS[i % COLORS.length],
        hair: HAIRS[i % HAIRS.length],
        desk: spot,
        look: undefined,
        deskStyle: undefined,
      };
      setCurrent(i);
      return { ...l, agents: [...l.agents, fresh] };
    });
    go("quem");
  }

  // Ao sair do "lugar": volta para a equipe.
  if (stage === "lugar") onNext = () => go("equipe");
  if (stage === "equipe" && layout.agents.length) onNext = editing ? () => void finish() : () => go("pronto");

  // Setas do teclado, como no Call (fora de campos de texto).
  const keys = useRef({ next: onNext, back, canNext: Boolean(nextLabel) });
  keys.current = { next: onNext, back, canNext: Boolean(nextLabel) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" && keys.current.canNext) keys.current.next();
      if (e.key === "ArrowLeft") keys.current.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="ob" ref={root} role="dialog" aria-label={editing ? "Equipe do Escritório" : "Tutorial do Escritório"}>
      <div className="ob-glow a" ref={glowA} />
      <div className="ob-glow b" ref={glowB} />
      <div className="ob-stage">
        <div className="ob-screen" ref={screen} key={`${stage}:${current}`}>
          {body}
          {error && <p className="office-error ob-error">{error}</p>}
        </div>
      </div>
      <div className="ob-bar">
        {editing ? (
          <button type="button" className="ob-skip" onClick={onClose}>
            Cancelar
          </button>
        ) : stage === "usar" || stage === "pronto" ? (
          <button type="button" className="ob-skip" onClick={onClose}>
            Decidir depois
          </button>
        ) : order.indexOf(stage) < order.indexOf("usar") ? (
          <button type="button" className="ob-skip" onClick={() => go("usar")}>
            Pular a explicação
          </button>
        ) : (
          <span />
        )}
        <div className="ob-dots">
          {!editing && steps.map((s, i) => <span key={s} className={"ob-dot" + (i < progress ? " on" : "")} />)}
        </div>
        <div className="ob-nav">
          {stage !== "boas" && !(editing && stage === "equipe") && (
            <button type="button" onClick={back}>
              Voltar
            </button>
          )}
          {nextLabel && (
            <button type="button" className="primary" onClick={onNext}>
              {nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="ob-card">
      <span className="ob-card-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

// Editor do personagem ou da mesa (os mesmos do Golfinho Call, com prévia 3D girando). O valor
// vai para o agente a cada mudança, então "Continuar" já leva a escolha.
function CallEditor({
  kind,
  agent,
  onValue,
}: {
  kind: "personagem" | "mesa";
  agent: OfficeAgent;
  onValue: (value: Record<string, unknown>) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const push = useRef(onValue);
  push.current = onValue;
  useEffect(() => {
    const box = host.current;
    if (!box) return;
    let editor: EditorHandle | DeskEditorHandle;
    try {
      if (kind === "personagem") {
        const ed = createEditor(agentLook(agent), () => push.current({ ...ed.look() }), { lockBody: true });
        editor = ed;
      } else {
        const ed = createDeskEditor(agentDesk(agent), agent.color, agent.name, () => push.current({ ...ed.style() }));
        editor = ed;
      }
    } catch {
      return;
    }
    box.append(editor.element);
    return () => {
      editor.dispose();
      editor.element.remove();
    };
    // O editor nasce uma vez por agente e por tipo; as mudanças vêm dele mesmo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, agent.id, agent.article]);
  return <div className="call-ed ob-editor ob-in" ref={host} />;
}

// A sala vista de cima, no escuro como o escritório: paredes, móveis, as mesas da equipe e a
// sombra de onde a mesa vai. Clique para colocar a mesa do agente em edição.
function RoomPicker({ layout, current, onPick }: { layout: OfficeLayout; current: string; onPick: (c: Cell) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const k = 28;
  const ref = { type: "agent" as const, id: current };
  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): Cell => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      col: Math.min(layout.cols - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * layout.cols) - 1)),
      row: Math.min(layout.rows - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * layout.rows))),
    };
  };
  useEffect(() => {
    const c = canvas.current;
    const x = c?.getContext("2d");
    if (!c || !x) return;
    c.width = layout.cols * k;
    c.height = layout.rows * k;
    x.fillStyle = "#2a1d14";
    x.fillRect(0, 0, c.width, c.height);
    for (let row = 0; row < layout.rows; row++)
      for (let col = 0; col < layout.cols; col++) {
        const t = tileAt(layout, { col, row });
        x.fillStyle = isWallTile(t) ? (t === "janela" ? "#1d3550" : "#141922") : t === "tapete" ? "#16303a" : (col + row) % 2 ? "#33241a" : "#2e2017";
        x.fillRect(col * k, row * k, k, k);
      }
    x.font = "600 11px system-ui, sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    const NAME: Record<string, string> = { chefe: "Você", quadro: "Quadro", telao: "Telão", reuniao: "Reunião", planta: "", sofa: "Sofá", estante: "Estante", bebedouro: "Água" };
    for (const f of layout.furniture) {
      const { w, h } = FOOTPRINT[f.kind];
      x.fillStyle = f.kind === "chefe" ? "#7c5a1a" : f.kind === "planta" ? "#2f7d55" : "#334155";
      x.beginPath();
      x.roundRect(f.col * k + 2, f.row * k + 2, w * k - 4, h * k - 4, 5);
      x.fill();
      if (NAME[f.kind]) {
        x.fillStyle = "#e2e8f0";
        x.fillText(NAME[f.kind], (f.col + w / 2) * k, (f.row + h / 2) * k);
      }
    }
    for (const a of layout.agents) {
      const mine = a.id === current;
      x.fillStyle = mine ? a.color : "#475569";
      x.globalAlpha = mine ? 1 : 0.85;
      x.beginPath();
      x.roundRect(a.desk.col * k + 2, a.desk.row * k + 2, 3 * k - 4, 2 * k - 4, 6);
      x.fill();
      x.globalAlpha = 1;
      x.fillStyle = "#0b0f16";
      x.fillText(a.name || "?", (a.desk.col + 1.5) * k, (a.desk.row + 1) * k);
    }
    if (hover) {
      const ok = fits(layout, "mesa", hover, ref);
      x.strokeStyle = ok ? "#2dd4bf" : "#ef4444";
      x.lineWidth = 2;
      x.setLineDash([5, 4]);
      x.strokeRect(hover.col * k + 2, hover.row * k + 2, 3 * k - 4, 2 * k - 4);
      x.setLineDash([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, current, hover]);
  return (
    <canvas
      ref={canvas}
      className="ob-room ob-in"
      aria-label="Planta da sala"
      onMouseMove={(e) => setHover(cellAt(e))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const c = cellAt(e);
        if (fits(layout, "mesa", c, ref)) onPick(c);
      }}
    />
  );
}
