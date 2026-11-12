import { it, expect } from "vitest";
import { defaultLayout, deskFront, center } from "../src/shared/officeLayout";
import { agentPath, collides, direction, makeRoom, nearest, seatPoint, startPoint, step, targetAt } from "../src/renderer/officeGame";

const layout = defaultLayout();
const room = makeRoom(layout);
const agent = (id: string) => layout.agents.find((a) => a.id === id)!;

it("ninguém atravessa mesa nem parede", () => {
  const ana = agent("ana");
  expect(collides(room, seatPoint(ana))).toBe(true);
  expect(collides(room, { x: 300, y: 20 })).toBe(true);
  expect(collides(room, center({ col: 12, row: 7 }))).toBe(false);
  const front = center(deskFront(ana));
  expect(step(room, front, 0, -30).y).toBe(front.y);
});

it("os pontos de conversa ficam livres e ao alcance", () => {
  for (const a of layout.agents) {
    const q = center(deskFront(a));
    expect(collides(room, q)).toBe(false);
    expect(nearest(room, q)).toEqual({ kind: "agent", agent: a });
  }
  expect(nearest(room, startPoint(room))).toEqual({ kind: "boss" });
  expect(nearest(room, center({ col: 8, row: 2 }))).toEqual({ kind: "board" });
  expect(nearest(room, center({ col: 12, row: 7 }))).toBeNull();
});

it("clique numa mesa escolhe a pessoa", () => {
  const bruno = agent("bruno");
  expect(targetAt(room, seatPoint(bruno))).toEqual({ kind: "agent", agent: bruno });
  expect(targetAt(room, center({ col: 12, row: 14 }))).toEqual({ kind: "boss" });
  expect(targetAt(room, center({ col: 8, row: 1 }))).toEqual({ kind: "board" });
});

it("o agente sai da mesa, desvia dos móveis e volta para a cadeira", () => {
  const ana = agent("ana");
  const path = agentPath(room, ana, deskFront(agent("eva")))!;
  expect(path.go.at(-1)).toEqual(center(deskFront(agent("eva"))));
  expect(path.back.at(-1)).toEqual(seatPoint(ana));
  for (const p of path.go.slice(1)) expect(collides(room, p, 1)).toBe(false);
});

it("a direção da mesa sai em palavras", () => {
  expect(direction(agent("ana"), agent("bruno"))).toBe("à direita");
  expect(direction(agent("bruno"), agent("eva"))).toBe("mais pra frente, à direita");
});

it("o telão é um lugar de conversa como os outros", () => {
  const screen = layout.furniture.find((f) => f.kind === "telao")!;
  const below = center({ col: screen.col + 2, row: screen.row + 1 });
  expect(nearest(room, below)).toEqual({ kind: "telao", id: screen.id });
  expect(targetAt(room, center({ col: screen.col + 1, row: screen.row }))).toEqual({ kind: "telao", id: screen.id });
});
