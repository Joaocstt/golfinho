// Geometria do Escritório em pixels, a partir da sala em grade (shared/officeLayout): colisão do
// chefe, o que está ao alcance, cliques e o caminho que os agentes fazem. Sem canvas nem React.
import type { OfficeAgent, OfficeLayout } from "../shared/office";
import {
  CELL,
  COLS,
  ROWS,
  board,
  boardSpot,
  boss,
  bossSpot,
  cellOf,
  center,
  deskExit,
  deskFront,
  findPath,
  inside,
  itemAt,
  screenSpot,
  screens,
  walkable,
  type Cell,
} from "../shared/officeLayout";

export const W = COLS * CELL;
export const H = ROWS * CELL;
export const RADIUS = 13;

export interface Point {
  x: number;
  y: number;
}
export interface Room {
  layout: OfficeLayout;
  grid: boolean[][];
}
export const makeRoom = (layout: OfficeLayout): Room => ({ layout, grid: walkable(layout) });

export type Target = { kind: "agent"; agent: OfficeAgent } | { kind: "boss" } | { kind: "board" } | { kind: "telao"; id: string };

export function collides(room: Room, p: Point, r = RADIUS): boolean {
  if (p.x < r || p.y < r || p.x > W - r || p.y > H - r) return true;
  const c0 = Math.floor((p.x - r) / CELL), c1 = Math.floor((p.x + r) / CELL);
  const r0 = Math.floor((p.y - r) / CELL), r1 = Math.floor((p.y + r) / CELL);
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      if (!inside(room.layout, { col, row }) || room.grid[row][col]) continue;
      const cx = Math.max(col * CELL, Math.min(p.x, col * CELL + CELL));
      const cy = Math.max(row * CELL, Math.min(p.y, row * CELL + CELL));
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 < r * r) return true;
    }
  return false;
}

/** Um passo do chefe: anda em x e em y separadamente para deslizar nas quinas. */
export function step(room: Room, p: Point, dx: number, dy: number, r = RADIUS): Point {
  let { x, y } = p;
  if (!collides(room, { x: x + dx, y }, r)) x += dx;
  if (!collides(room, { x, y: y + dy }, r)) y += dy;
  return { x, y };
}

export function spot(room: Room, t: Target): Cell {
  if (t.kind === "agent") return deskFront(t.agent);
  if (t.kind === "boss") return bossSpot(boss(room.layout)!);
  if (t.kind === "telao") {
    const f = room.layout.furniture.find((x) => x.id === t.id);
    if (f) return screenSpot(f);
  }
  return boardSpot(board(room.layout)!);
}
export const interactionPoint = (room: Room, t: Target): Point => center(spot(room, t));
/** Onde o chefe começa: no lugar dele, atrás da mesa. */
export const startPoint = (room: Room): Point => interactionPoint(room, { kind: "boss" });

export function targets(room: Room): Target[] {
  return [
    ...room.layout.agents.map((agent) => ({ kind: "agent" as const, agent })),
    { kind: "boss" },
    { kind: "board" },
    ...screens(room.layout).map((f) => ({ kind: "telao" as const, id: f.id })),
  ];
}

/** O que está ao alcance do chefe para apertar E, ou null. */
export function nearest(room: Room, p: Point, reach = 36): Target | null {
  let best: Target | null = null;
  let distance = reach;
  for (const t of targets(room)) {
    const q = interactionPoint(room, t);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < distance) {
      distance = d;
      best = t;
    }
  }
  return best;
}

/** O que fica sob um clique: mesa de agente, mesa do chefe ou quadro (ou o lugar de falar com eles). */
export function targetAt(room: Room, p: Point): Target | null {
  const cell = cellOf(p);
  const ref = itemAt(room.layout, cell);
  if (ref?.type === "agent") {
    const agent = room.layout.agents.find((a) => a.id === ref.id);
    if (agent) return { kind: "agent", agent };
  }
  if (ref?.type === "furniture") {
    const kind = room.layout.furniture.find((f) => f.id === ref.id)?.kind;
    if (kind === "chefe") return { kind: "boss" };
    if (kind === "quadro") return { kind: "board" };
    if (kind === "telao") return { kind: "telao", id: ref.id };
  }
  return targets(room).find((t) => {
    const s = spot(room, t);
    return s.col === cell.col && s.row === cell.row;
  }) ?? null;
}

/** Onde o agente fica sentado (os pés, atrás da mesa). */
export const seatPoint = (a: OfficeAgent): Point => ({ x: a.desk.col * CELL + CELL * 1.5, y: a.desk.row * CELL + 36 });

/** Ida da cadeira até a célula e a volta, em pontos; null se não houver caminho. */
export function agentPath(room: Room, a: OfficeAgent, to: Cell): { go: Point[]; back: Point[] } | null {
  const exit = deskExit(room.layout, a, room.grid);
  if (!exit) return null;
  const cells = findPath(room.layout, exit, to, room.grid);
  if (!cells) return null;
  const seat = seatPoint(a);
  const out = center(exit);
  const leave = { x: out.x, y: seat.y };
  const points = cells.map(center);
  return { go: [leave, ...points], back: [...points.slice(0, -1).reverse(), leave, seat] };
}

/** Direção da mesa de `to` vista da mesa de `from`, para a fala de encaminhamento. */
export function direction(from: OfficeAgent, to: OfficeAgent): string {
  const parts: string[] = [];
  if (to.desk.row < from.desk.row - 1) parts.push("lá no fundo");
  else if (to.desk.row > from.desk.row + 1) parts.push("mais pra frente");
  if (to.desk.col > from.desk.col + 1) parts.push("à direita");
  else if (to.desk.col < from.desk.col - 1) parts.push("à esquerda");
  return parts.length ? parts.join(", ") : "aqui do lado";
}
