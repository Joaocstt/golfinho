// A sala do Escritório como grade: células de 40 px, piso e paredes, móveis e mesas com tamanho
// fixo. Daqui saem os modelos prontos, a validação (usada no editor e de novo no processo
// principal), as operações do editor e os caminhos dos agentes. Sem DOM nem canvas.
import type { Furniture, FurnitureKind, OfficeAgent, OfficeLayout, TileKind } from "./office";

export const CELL = 40;
export const COLS = 25;
export const ROWS = 16;
export const MAX_AGENTS = 8;

export const TILE_CODE: Record<TileKind, string> = { piso: "f", tapete: "c", azulejo: "t", parede: "w", janela: "j" };
const CODE_TILE = Object.fromEntries(Object.entries(TILE_CODE).map(([k, v]) => [v, k])) as Record<string, TileKind>;
export const TILE_LABEL: Record<TileKind, string> = {
  piso: "Piso de madeira",
  tapete: "Tapete",
  azulejo: "Azulejo",
  parede: "Parede",
  janela: "Janela",
};
export const FURNITURE_LABEL: Record<FurnitureKind, string> = {
  planta: "Planta",
  quadro: "Quadro do projeto",
  chefe: "Mesa do chefe",
  sofa: "Sofá",
  estante: "Estante",
  bebedouro: "Bebedouro",
  telao: "Telão",
};
export const FOOTPRINT: Record<FurnitureKind | "mesa", { w: number; h: number }> = {
  planta: { w: 1, h: 1 },
  quadro: { w: 3, h: 1 },
  chefe: { w: 3, h: 2 },
  sofa: { w: 3, h: 1 },
  estante: { w: 2, h: 1 },
  bebedouro: { w: 1, h: 1 },
  telao: { w: 4, h: 1 },
  mesa: { w: 3, h: 2 },
};
/** Só pode haver um de cada, e eles não saem da sala. */
export const SINGLETONS: FurnitureKind[] = ["chefe", "quadro"];

export interface Cell {
  col: number;
  row: number;
}
export type ItemRef = { type: "furniture"; id: string } | { type: "agent"; id: string };

export const tileAt = (l: OfficeLayout, c: Cell): TileKind => CODE_TILE[l.tiles[c.row * l.cols + c.col]] ?? "piso";
export const isWallTile = (t: TileKind) => t === "parede" || t === "janela";
export const inside = (l: OfficeLayout, c: Cell) => c.col >= 0 && c.row >= 0 && c.col < l.cols && c.row < l.rows;
export const center = (c: Cell) => ({ x: c.col * CELL + CELL / 2, y: c.row * CELL + CELL / 2 });
export const cellOf = (p: { x: number; y: number }): Cell => ({ col: Math.floor(p.x / CELL), row: Math.floor(p.y / CELL) });

function footprintCells(col: number, row: number, kind: FurnitureKind | "mesa"): Cell[] {
  const { w, h } = FOOTPRINT[kind];
  const out: Cell[] = [];
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) out.push({ col: c, row: r });
  return out;
}
export const itemCells = (l: OfficeLayout, ref: ItemRef): Cell[] => {
  if (ref.type === "agent") {
    const a = l.agents.find((x) => x.id === ref.id);
    return a ? footprintCells(a.desk.col, a.desk.row, "mesa") : [];
  }
  const f = l.furniture.find((x) => x.id === ref.id);
  return f ? footprintCells(f.col, f.row, f.kind) : [];
};
const allItems = (l: OfficeLayout): ItemRef[] => [
  ...l.furniture.map((f) => ({ type: "furniture" as const, id: f.id })),
  ...l.agents.map((a) => ({ type: "agent" as const, id: a.id })),
];

/** Quadro e telão ficam na parede: não ocupam o chão. Todo o resto ocupa. */
export const ON_WALL: FurnitureKind[] = ["quadro", "telao"];
const occupies = (l: OfficeLayout, ref: ItemRef) => {
  const kind = ref.type === "furniture" ? l.furniture.find((f) => f.id === ref.id)?.kind : undefined;
  return !(kind && ON_WALL.includes(kind));
};

/** Grade de células por onde dá para andar. */
export function walkable(l: OfficeLayout): boolean[][] {
  const grid = Array.from({ length: l.rows }, (_, row) =>
    Array.from({ length: l.cols }, (_, col) => !isWallTile(tileAt(l, { col, row }))),
  );
  for (const ref of allItems(l))
    if (occupies(l, ref)) for (const c of itemCells(l, ref)) if (inside(l, c)) grid[c.row][c.col] = false;
  return grid;
}

export const boss = (l: OfficeLayout) => l.furniture.find((f) => f.kind === "chefe");
export const board = (l: OfficeLayout) => l.furniture.find((f) => f.kind === "quadro");
/** Onde o chefe para para falar com o agente: na frente da mesa. */
export const deskFront = (a: OfficeAgent): Cell => ({ col: a.desk.col + 1, row: a.desk.row + 2 });
/** Onde o chefe se senta para ver as entregas: atrás da mesa dele (acima, na tela). */
export const bossSpot = (f: Furniture): Cell => ({ col: f.col + 1, row: f.row - 1 });
/** Onde se lê o quadro: logo abaixo dele. */
export const boardSpot = (f: Furniture): Cell => ({ col: f.col + 1, row: f.row + 1 });
/** Onde se olha o telão: logo abaixo, no meio. */
export const screenSpot = (f: Furniture): Cell => ({ col: f.col + 2, row: f.row + 1 });
export const screens = (l: OfficeLayout) => l.furniture.filter((f) => f.kind === "telao");

/** Por onde o agente sai da cadeira: pelos lados da mesa, ou pela frente. */
export function deskExit(l: OfficeLayout, a: OfficeAgent, grid = walkable(l)): Cell | null {
  const options = [
    { col: a.desk.col + 3, row: a.desk.row + 1 },
    { col: a.desk.col - 1, row: a.desk.row + 1 },
    { col: a.desk.col + 3, row: a.desk.row },
    { col: a.desk.col - 1, row: a.desk.row },
    deskFront(a),
  ];
  return options.find((c) => inside(l, c) && grid[c.row][c.col]) ?? null;
}

/** Caminho mais curto entre duas células (A* em 4 direções), incluindo as pontas. */
export function findPath(l: OfficeLayout, from: Cell, to: Cell, grid = walkable(l)): Cell[] | null {
  if (!inside(l, from) || !inside(l, to) || !grid[to.row][to.col]) return null;
  const key = (c: Cell) => c.row * l.cols + c.col;
  const h = (c: Cell) => Math.abs(c.col - to.col) + Math.abs(c.row - to.row);
  const open: { c: Cell; f: number }[] = [{ c: from, f: h(from) }];
  const g = new Map<number, number>([[key(from), 0]]);
  const prev = new Map<number, Cell>();
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const { c } = open.shift()!;
    if (c.col === to.col && c.row === to.row) {
      const path = [c];
      let k = key(c);
      while (prev.has(k)) {
        const p = prev.get(k)!;
        path.unshift(p);
        k = key(p);
      }
      return path;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { col: c.col + dc, row: c.row + dr };
      if (!inside(l, n) || !grid[n.row][n.col]) continue;
      const cost = g.get(key(c))! + 1;
      if (cost < (g.get(key(n)) ?? Infinity)) {
        g.set(key(n), cost);
        prev.set(key(n), c);
        open.push({ c: n, f: cost + h(n) });
      }
    }
  }
  return null;
}

/** Problemas que impedem salvar a sala, em português, para mostrar no editor. */
export function layoutProblems(l: OfficeLayout): string[] {
  const out: string[] = [];
  if (l.cols !== COLS || l.rows !== ROWS || l.tiles.length !== l.cols * l.rows) out.push("O tamanho da sala está inválido.");
  if (!l.agents.length) out.push("Coloque pelo menos uma mesa com um agente.");
  if (l.agents.length > MAX_AGENTS) out.push(`A equipe tem no máximo ${MAX_AGENTS} agentes.`);
  for (const kind of SINGLETONS) {
    const n = l.furniture.filter((f) => f.kind === kind).length;
    if (n !== 1) out.push(`A sala precisa de exatamente um item "${FURNITURE_LABEL[kind]}".`);
  }
  const ids = new Set<string>();
  for (const a of l.agents) {
    if (ids.has(a.id)) out.push(`Agente repetido: ${a.name}.`);
    ids.add(a.id);
    if (!a.name.trim()) out.push("Todo agente precisa de um nome.");
  }
  const names = l.agents.map((a) => a.name.trim().toLocaleLowerCase());
  if (new Set(names).size !== names.length) out.push("Dois agentes com o mesmo nome confundem os encaminhamentos.");
  if (l.reviewer && !l.agents.some((a) => a.id === l.reviewer)) out.push("O revisor escolhido não está na equipe.");
  if (out.length) return out;
  // Sobreposição, limites e chão.
  const taken = new Map<number, string>();
  const label = (ref: ItemRef) =>
    ref.type === "agent"
      ? `a mesa d${l.agents.find((a) => a.id === ref.id)?.article ?? "e"} ${l.agents.find((a) => a.id === ref.id)?.name ?? ""}`
      : FURNITURE_LABEL[l.furniture.find((f) => f.id === ref.id)!.kind];
  for (const ref of allItems(l)) {
    const quadro = !occupies(l, ref);
    for (const c of itemCells(l, ref)) {
      if (!inside(l, c)) {
        out.push(`${cap(label(ref))} saiu da sala.`);
        break;
      }
      if (!quadro && isWallTile(tileAt(l, c))) {
        out.push(`${cap(label(ref))} está em cima de uma parede.`);
        break;
      }
      if (quadro) continue;
      const k = c.row * l.cols + c.col;
      if (taken.has(k)) {
        out.push(`${cap(label(ref))} está em cima de ${taken.get(k)}.`);
        break;
      }
      taken.set(k, label(ref));
    }
  }
  if (out.length) return [...new Set(out)];
  // Todo mundo alcançável a partir da mesa do chefe.
  const grid = walkable(l);
  const start = bossSpot(boss(l)!);
  if (!inside(l, start) || !grid[start.row][start.col]) return ["Deixe livre o lugar do chefe, logo acima da mesa dele."];
  const spots: [string, Cell][] = [
    ["o quadro do projeto", boardSpot(board(l)!)],
    ...l.agents.map((a): [string, Cell] => [`a mesa d${a.article} ${a.name}`, deskFront(a)]),
  ];
  for (const [what, spot] of spots)
    if (!findPath(l, start, spot, grid)) out.push(`O chefe não consegue chegar n${what.startsWith("o ") ? "o" : "a"} ${what.slice(2)}.`);
  for (const a of l.agents) if (!deskExit(l, a, grid)) out.push(`${a.name} não tem por onde sair da mesa.`);
  return out;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------- Operações do editor: sempre devolvem uma sala nova ----------------

export function paint(l: OfficeLayout, c: Cell, tile: TileKind): OfficeLayout {
  if (!inside(l, c)) return l;
  const i = c.row * l.cols + c.col;
  if (l.tiles[i] === TILE_CODE[tile]) return l;
  return { ...l, tiles: l.tiles.slice(0, i) + TILE_CODE[tile] + l.tiles.slice(i + 1) };
}

/** O que está na célula: mesa de agente ou móvel (o de cima primeiro). */
export function itemAt(l: OfficeLayout, c: Cell): ItemRef | null {
  for (const ref of [...allItems(l)].reverse())
    if (itemCells(l, ref).some((x) => x.col === c.col && x.row === c.row)) return ref;
  return null;
}

/** Cabe ali? Dentro da sala, no chão (o quadro vai na parede) e sem encostar em outro item. */
export function fits(l: OfficeLayout, kind: FurnitureKind | "mesa", at: Cell, ignore?: ItemRef): boolean {
  const cells = footprintCells(at.col, at.row, kind);
  if (!cells.every((c) => inside(l, c))) return false;
  if (kind !== "mesa" && ON_WALL.includes(kind)) return true;
  if (cells.some((c) => isWallTile(tileAt(l, c)))) return false;
  return !allItems(l).some(
    (ref) =>
      !(ignore && ref.type === ignore.type && ref.id === ignore.id) &&
      occupies(l, ref) &&
      itemCells(l, ref).some((x) => cells.some((c) => c.col === x.col && c.row === x.row)),
  );
}

export function placeFurniture(l: OfficeLayout, kind: FurnitureKind, at: Cell, id: string): OfficeLayout | null {
  const existing = SINGLETONS.includes(kind) ? l.furniture.find((f) => f.kind === kind) : undefined;
  if (!fits(l, kind, at, existing && { type: "furniture", id: existing.id })) return null;
  if (existing)
    return { ...l, furniture: l.furniture.map((f) => (f.id === existing.id ? { ...f, col: at.col, row: at.row } : f)) };
  return { ...l, furniture: [...l.furniture, { id, kind, col: at.col, row: at.row }] };
}

const PALETTE = ["#e07a5f", "#3d85c6", "#9b5de5", "#2a9d8f", "#f4a261", "#e9c46a", "#ef476f", "#118ab2"];
export function newAgent(l: OfficeLayout, at: Cell): OfficeAgent {
  let n = l.agents.length + 1;
  while (l.agents.some((a) => a.id === `agente-${n}`)) n++;
  return {
    id: `agente-${n}`,
    name: `Agente ${n}`,
    article: "o",
    role: "Assistente",
    area: "tarefas gerais",
    scope: "tarefas gerais do projeto",
    personality: "prestativo e direto",
    mode: "deliver",
    web: false,
    model: "padrao",
    color: PALETTE[(n - 1) % PALETTE.length],
    hair: "#3b2a1a",
    desk: { ...at },
  };
}

export function addDesk(l: OfficeLayout, at: Cell): { layout: OfficeLayout; id: string } | null {
  if (l.agents.length >= MAX_AGENTS || !fits(l, "mesa", at)) return null;
  const agent = newAgent(l, at);
  return { layout: { ...l, agents: [...l.agents, agent] }, id: agent.id };
}

export function moveItem(l: OfficeLayout, ref: ItemRef, at: Cell): OfficeLayout | null {
  if (ref.type === "agent") {
    if (!fits(l, "mesa", at, ref)) return null;
    return { ...l, agents: l.agents.map((a) => (a.id === ref.id ? { ...a, desk: { ...at } } : a)) };
  }
  const f = l.furniture.find((x) => x.id === ref.id);
  if (!f || !fits(l, f.kind, at, ref)) return null;
  return { ...l, furniture: l.furniture.map((x) => (x.id === ref.id ? { ...x, col: at.col, row: at.row } : x)) };
}

/** Mesa do chefe e quadro não saem: só mudam de lugar. */
export function removeItem(l: OfficeLayout, ref: ItemRef): OfficeLayout {
  if (ref.type === "agent")
    return { ...l, agents: l.agents.filter((a) => a.id !== ref.id), reviewer: l.reviewer === ref.id ? null : l.reviewer };
  const f = l.furniture.find((x) => x.id === ref.id);
  if (!f || SINGLETONS.includes(f.kind)) return l;
  return { ...l, furniture: l.furniture.filter((x) => x.id !== ref.id) };
}

export function updateAgent(l: OfficeLayout, id: string, patch: Partial<Omit<OfficeAgent, "id" | "desk">>): OfficeLayout {
  return { ...l, agents: l.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

// ---------------- Modelos prontos ----------------

function room(): string {
  let tiles = "";
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      if (row === 0) tiles += col % 6 >= 2 && col % 6 <= 4 && col > 1 && col < COLS - 2 ? "j" : "w";
      else if (row === 1) tiles += "w";
      else if (row === 7 && col > 0 && col < COLS - 1) tiles += "c";
      else tiles += "f";
    }
  return tiles;
}
const corners = (): Furniture[] => [
  { id: "planta-1", kind: "planta", col: 0, row: 2 },
  { id: "planta-2", kind: "planta", col: 24, row: 2 },
  { id: "planta-3", kind: "planta", col: 0, row: 15 },
  { id: "planta-4", kind: "planta", col: 24, row: 15 },
  { id: "quadro", kind: "quadro", col: 7, row: 1 },
  { id: "telao", kind: "telao", col: 14, row: 1 },
  { id: "chefe", kind: "chefe", col: 11, row: 13 },
];
const agent = (a: Partial<OfficeAgent> & Pick<OfficeAgent, "id" | "name" | "article" | "role" | "area" | "scope" | "personality" | "color" | "hair" | "desk">): OfficeAgent => ({
  mode: "deliver",
  web: false,
  model: "padrao",
  ...a,
});
const ANA = agent({
  id: "ana", name: "Ana", article: "a", role: "Pesquisadora", area: "pesquisa",
  scope: "pesquisa, análise de mercado e de concorrentes, levantamento de dados, relatórios e comparações",
  personality: "curiosa e metódica, cita de onde tirou cada dado", web: true,
  color: "#e07a5f", hair: "#5a3825", desk: { col: 3, row: 3 },
});
const BRUNO = agent({
  id: "bruno", name: "Bruno", article: "o", role: "Programador", area: "programação",
  scope: "código: bugs, novas funcionalidades, refatoração, testes automatizados, scripts, build",
  personality: "descontraído, fala como dev, mas é cuidadoso com o código", mode: "task",
  color: "#3d85c6", hair: "#222222", desk: { col: 11, row: 3 },
});
const CARLA = agent({
  id: "carla", name: "Carla", article: "a", role: "Designer", area: "design",
  scope: "design: interface, telas, layout, identidade visual, logo, cores, ícones, experiência de uso",
  personality: "criativa e entusiasmada, pensa em cores e formas",
  color: "#9b5de5", hair: "#c1440e", desk: { col: 19, row: 3 },
});
const DAVI = agent({
  id: "davi", name: "Davi", article: "o", role: "Redator", area: "textos",
  scope: "textos: README, documentação, textos da interface, posts, e-mails, notas de versão, roteiros",
  personality: "tem alma de poeta, mas escreve direto ao ponto",
  color: "#2a9d8f", hair: "#7a5230", desk: { col: 5, row: 9 },
});
const EVA = agent({
  id: "eva", name: "Eva", article: "a", role: "Revisora", area: "revisão",
  scope: "revisão e qualidade: revisar código, textos e planos, procurar erros, conferir o que foi feito",
  personality: "exigente e detalhista, mas gentil",
  color: "#f4a261", hair: "#111111", desk: { col: 17, row: 9 },
});

export const TEMPLATES: { id: string; label: string; hint: string; build: () => OfficeLayout }[] = [
  {
    id: "startup",
    label: "Startup",
    hint: "Pesquisa, código, design, textos e revisão.",
    build: () => ({ cols: COLS, rows: ROWS, tiles: room(), furniture: corners(), agents: [ANA, BRUNO, CARLA, DAVI, EVA], reviewer: "eva" }),
  },
  {
    id: "dev",
    label: "Só dev",
    hint: "Um programador e uma revisora.",
    build: () => ({
      cols: COLS, rows: ROWS, tiles: room(),
      furniture: [...corners(), { id: "sofa-1", kind: "sofa", col: 3, row: 10 }, { id: "bebedouro-1", kind: "bebedouro", col: 21, row: 10 }],
      agents: [{ ...BRUNO, desk: { col: 7, row: 3 } }, { ...EVA, desk: { col: 15, row: 3 } }],
      reviewer: "eva",
    }),
  },
  {
    id: "agencia",
    label: "Agência",
    hint: "Pesquisa, design e textos, com revisão.",
    build: () => ({
      cols: COLS, rows: ROWS, tiles: room(),
      furniture: [...corners(), { id: "estante-1", kind: "estante", col: 21, row: 10 }],
      agents: [ANA, { ...CARLA, desk: { col: 11, row: 3 } }, { ...DAVI, desk: { col: 19, row: 3 } }, { ...EVA, desk: { col: 11, row: 9 } }],
      reviewer: "eva",
    }),
  },
];
export const defaultLayout = () => TEMPLATES[0].build();
