// Desenho do Escritório no canvas: piso, paredes, móveis, mesas e pessoas, tudo a partir da sala
// em grade. Só desenha; quem está andando, pensando ou trabalhando vem de fora.
import type { Furniture, OfficeAgent, OfficeLayout } from "../shared/office";
import { CELL, FOOTPRINT, tileAt, type Cell } from "../shared/officeLayout";
import { H, W } from "./officeGame";

type Ctx = CanvasRenderingContext2D;
const SKIN = "#f1c8a0";

export function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawTiles(ctx: Ctx, l: OfficeLayout) {
  for (let row = 0; row < l.rows; row++)
    for (let col = 0; col < l.cols; col++) {
      const x = col * CELL, y = row * CELL;
      const tile = tileAt(l, { col, row });
      if (tile === "piso") {
        ctx.fillStyle = (col + row) % 2 ? "#d9c9a8" : "#d2c19e";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = "#0000000a";
        ctx.fillRect(x, y + 19, CELL, 1);
      } else if (tile === "tapete") {
        ctx.fillStyle = "#b9a07a";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = "#c9b28c";
        ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      } else if (tile === "azulejo") {
        ctx.fillStyle = "#e4ebee";
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = "#c5d0d5";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL / 2, CELL / 2);
        ctx.strokeRect(x + CELL / 2 + 0.5, y + CELL / 2 + 0.5, CELL / 2 - 1, CELL / 2 - 1);
      } else {
        ctx.fillStyle = "#5b6b8c";
        ctx.fillRect(x, y, CELL, CELL);
        const below = row + 1 < l.rows ? tileAt(l, { col, row: row + 1 }) : "parede";
        if (below !== "parede" && below !== "janela") {
          ctx.fillStyle = "#48577a";
          ctx.fillRect(x, y + CELL - 8, CELL, 8);
        }
        if (tile === "janela") {
          rr(ctx, x + 4, y + 8, CELL - 8, CELL - 18, 2, "#a9d6f5");
          ctx.fillStyle = "#e5f4ff88";
          ctx.fillRect(x + 8, y + 10, 7, CELL - 22);
        }
      }
    }
}

export function drawPerson(
  ctx: Ctx,
  x: number,
  y: number,
  color: string,
  hair: string,
  o: { moving?: boolean; phase?: number; tie?: boolean; carry?: boolean } = {},
) {
  const bob = o.moving ? Math.sin(o.phase ?? 0) * 2 : 0;
  const leg = o.moving ? Math.sin(o.phase ?? 0) * 4 : 0;
  ctx.fillStyle = "#0003";
  ctx.beginPath();
  ctx.ellipse(x, y, 12, 5, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#2b2d42";
  ctx.fillRect(x - 7, y - 10 + Math.max(0, leg), 5, 10 - Math.max(0, leg));
  ctx.fillRect(x + 2, y - 10 + Math.max(0, -leg), 5, 10 - Math.max(0, -leg));
  rr(ctx, x - 10, y - 30 + bob, 20, 22, 5, color);
  if (o.tie) {
    ctx.fillStyle = "#c1121f";
    ctx.beginPath();
    ctx.moveTo(x, y - 29 + bob);
    ctx.lineTo(x - 3, y - 18 + bob);
    ctx.lineTo(x, y - 13 + bob);
    ctx.lineTo(x + 3, y - 18 + bob);
    ctx.fill();
  }
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(x, y - 38 + bob, 9, 0, 7);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(x, y - 40 + bob, 9.5, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.fillRect(x - 4, y - 38 + bob, 2, 2);
  ctx.fillRect(x + 2, y - 38 + bob, 2, 2);
  if (o.carry) {
    rr(ctx, x + 8, y - 26 + bob, 12, 15, 2, "#fff");
    ctx.fillStyle = "#999";
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 10, y - 23 + bob + i * 4, 8, 1);
  }
}

export interface DeskLook {
  seated: boolean;
  screen: "off" | "work" | "think";
  queued: number;
  phase: number;
}

export function drawDesk(ctx: Ctx, a: OfficeAgent, look: DeskLook, t: number) {
  const x = a.desk.col * CELL, y = a.desk.row * CELL;
  rr(ctx, x + 46, y + 2, 28, 30, 6, "#444");
  if (look.seated) drawPerson(ctx, x + 60, y + 36, a.color, a.hair);
  rr(ctx, x, y + 30, 120, 44, 5, "#8d6e4f");
  ctx.fillStyle = "#6f553c";
  ctx.fillRect(x, y + 67, 120, 7);
  rr(ctx, x + 40, y + 16, 40, 26, 3, "#222");
  ctx.fillStyle =
    look.screen === "work" ? (Math.sin(t * 8 + look.phase) > 0 ? "#4cc9f0" : "#3aa0d0") : look.screen === "think" ? "#ffd166" : "#34495e";
  ctx.fillRect(x + 43, y + 19, 34, 19);
  for (let i = 0; i < Math.min(look.queued, 6); i++) rr(ctx, x + 88, y + 40 - i * 3, 22, 14, 1, i % 2 ? "#f1f1f1" : "#fff");
  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "center";
  const label = `${a.name} · ${a.role}`;
  const lw = ctx.measureText(label).width + 14;
  rr(ctx, x + 60 - lw / 2, y + 78, lw, 18, 9, "#000a");
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x + 60, y + 91);
}

export function drawFurniture(ctx: Ctx, f: Furniture, o: { project: string; delivered: number; unread: number; t: number; summary?: string }) {
  const x = f.col * CELL, y = f.row * CELL;
  if (f.kind === "planta") {
    rr(ctx, x + 6, y + 18, 28, 20, 4, "#8b5a2b");
    ctx.fillStyle = "#3c8d40";
    for (const [ox, oy] of [[-9, -8], [9, -8], [0, -16], [0, -4]]) {
      ctx.beginPath();
      ctx.arc(x + 20 + ox, y + 20 + oy, 10, 0, 7);
      ctx.fill();
    }
  } else if (f.kind === "quadro") {
    rr(ctx, x + 2, y + 2, 116, 34, 3, "#f4f4f0");
    ctx.strokeStyle = "#8d6e4f";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, 116, 34);
    ctx.fillStyle = "#264653";
    ctx.textAlign = "center";
    ctx.font = "bold 10px system-ui";
    ctx.fillText("PROJETO", x + 60, y + 15);
    ctx.font = "12px system-ui";
    const name = o.project || "escolha um";
    ctx.fillText(name.length > 17 ? `${name.slice(0, 16)}…` : name, x + 60, y + 30);
  } else if (f.kind === "chefe") {
    rr(ctx, x, y + 18, 120, 48, 6, "#5e3b22");
    ctx.fillStyle = "#4a2e1a";
    ctx.fillRect(x, y + 58, 120, 8);
    rr(ctx, x + 10, y + 24, 34, 22, 2, "#c9a227");
    for (let i = 0; i < Math.min(o.delivered, 6); i++) rr(ctx, x + 13, y + 26 - i * 3, 28, 18, 1, "#fff");
    ctx.font = "bold 12px system-ui";
    ctx.fillStyle = "#ffd166";
    ctx.textAlign = "left";
    ctx.fillText("MESA DO CHEFE", x + 50, y + 44);
    if (o.unread) {
      const by = y + 2 + Math.sin(o.t * 6) * 4;
      ctx.beginPath();
      ctx.arc(x + 27, by, 13, 0, 7);
      ctx.fillStyle = "#e63946";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(o.unread), x + 27, by + 5);
    }
  } else if (f.kind === "sofa") {
    rr(ctx, x + 2, y + 4, 116, 14, 6, "#6d597a");
    rr(ctx, x + 2, y + 14, 116, 22, 6, "#7d6b8a");
    rr(ctx, x, y + 8, 12, 28, 5, "#5c4a68");
    rr(ctx, x + 108, y + 8, 12, 28, 5, "#5c4a68");
  } else if (f.kind === "estante") {
    rr(ctx, x + 2, y, 76, 38, 3, "#6f553c");
    const books = ["#e07a5f", "#3d85c6", "#e9c46a", "#2a9d8f", "#9b5de5", "#ef476f"];
    for (let shelf = 0; shelf < 2; shelf++)
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = books[(i + shelf * 2) % books.length];
        ctx.fillRect(x + 8 + i * 11, y + 4 + shelf * 17, 8, 14);
      }
  } else if (f.kind === "telao") {
    rr(ctx, x + 2, y + 1, 156, 36, 4, "#101318");
    rr(ctx, x + 6, y + 4, 148, 28, 2, "#16324f");
    ctx.fillStyle = "#4cc9f0";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("TELÃO · CONTROLE", x + 80, y + 15);
    ctx.fillStyle = "#cfe8ff";
    ctx.font = "10px system-ui";
    ctx.fillText(o.summary ?? "", x + 80, y + 28);
  } else if (f.kind === "bebedouro") {
    rr(ctx, x + 10, y + 16, 20, 22, 3, "#dfe7ea");
    rr(ctx, x + 12, y + 2, 16, 16, 6, "#7cc6ef");
  }
}

export function drawBubble(ctx: Ctx, x: number, y: number, text: string) {
  ctx.font = "12px system-ui";
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > 170 && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  lines.push(line);
  const shown = lines.slice(0, 3);
  const w = Math.max(...shown.map((l) => ctx.measureText(l).width)) + 16;
  const h = shown.length * 15 + 10;
  const bx = Math.min(Math.max(x - w / 2, 4), W - w - 4);
  const by = Math.max(4, y - h);
  rr(ctx, bx, by, w, h, 8, "#fff");
  ctx.beginPath();
  ctx.moveTo(x - 6, by + h);
  ctx.lineTo(x + 6, by + h);
  ctx.lineTo(x, by + h + 7);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.textAlign = "left";
  shown.forEach((l, i) => ctx.fillText(l, bx + 8, by + 17 + i * 15));
}

export function drawLabel(ctx: Ctx, x: number, y: number, text: string) {
  ctx.font = "bold 13px system-ui";
  const w = ctx.measureText(text).width + 16;
  rr(ctx, x - w / 2, y, w, 22, 6, "#000c");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y + 16);
}

/** Editor: grade, a área que o item ocuparia (verde cabe, vermelho não) e o item escolhido. */
export function drawEditorOverlay(
  ctx: Ctx,
  o: { ghost: { cell: Cell; kind: keyof typeof FOOTPRINT | "tile"; ok: boolean } | null; selected: Cell[] },
) {
  ctx.strokeStyle = "#0000001f";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += CELL) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += CELL) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  for (const c of o.selected) {
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    ctx.strokeRect(c.col * CELL + 1.5, c.row * CELL + 1.5, CELL - 3, CELL - 3);
  }
  if (o.ghost) {
    const { w, h } = o.ghost.kind === "tile" ? { w: 1, h: 1 } : FOOTPRINT[o.ghost.kind];
    ctx.fillStyle = o.ghost.ok ? "#06d6a055" : "#e6394655";
    ctx.fillRect(o.ghost.cell.col * CELL, o.ghost.cell.row * CELL, w * CELL, h * CELL);
  }
}
