// Escritório em 3D (three.js): a mesma sala em grade, desenhada em low-poly com luz e sombras,
// e a câmera em terceira pessoa atrás do chefe. A lógica (colisão, caminhos, quem está fazendo o
// quê) continua em pixels 2D em officeGame; aqui 1 célula de 40 px vira 1 unidade do mundo.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Furniture, OfficeAgent, OfficeLayout } from "../shared/office";
import { CELL, FOOTPRINT, isWallTile, tileAt } from "../shared/officeLayout";
import type { Point } from "./officeGame";
import { AVATAR_OPTIONS, Character, preloadAvatars } from "./office3d/avatar";
import { PET_OPTIONS, PetFollower, makePet } from "./office3d/pets";
import { buildDesk, DEFAULT_DESK, MONITOR_H, MONITOR_W, MONITOR_Y, screenGeometry, type DeskModel, type DeskStyle } from "./office3d/desk3d";
import { makeChair } from "./office3d/chair";
import { agentDesk, agentLook, bossLook, deskKey, lookKey } from "./office3d/officeLooks";
import { CALL_THEME as T, cityCanvas, makePlant as callPlant, makeSofa as callSofa, woodCanvas } from "./office3d/room";

const U = (px: number) => px / CELL;
/** Pixels desenhados por quadro, no máximo (~1440x900): medido numa placa integrada, a sala
 * custa ~23 ms por milhão de pixels; com isso a tela cheia fica perto de 60 quadros por segundo. */
const PIXEL_BUDGET = 1_000_000;
/** Abaixo disso a sala fica borrada demais: melhor alguns quadros a menos. */
const MIN_RATIO = 0.6;
// Pessoas e mesas do Golfinho Call estão em metros; na sala, 1 célula = 1 unidade. Nessa escala
// a pessoa tem ~1,45 e a mesa grande (3,4 m) cabe nas 3 células da mesa.
const S = 0.8;
// Dentro das 2 linhas da mesa: o tampo em cima (fundo) e a cadeira embaixo, virada para o monitor.
// Quem chega pela frente (deskFront) fica atrás da pessoa e vê a tela por cima do ombro.
const DESK_Z = 0.6;
const CHAIR_Z = DESK_Z + 1.25 * S;
/** Sentado, o personagem fica um pouco à frente do centro do assento (medido na animação). */
const SIT_Z = CHAIR_Z - 0.23 * S;

export type PickTarget =
  | { kind: "agent"; id: string }
  | { kind: "boss" }
  | { kind: "board" }
  | { kind: "telao"; id: string }
  | { kind: "reuniao"; id: string }
  | { kind: "bosspc" };
export interface Pick {
  target: PickTarget | null;
  floor: Point | null;
}

export interface AgentView {
  agent: OfficeAgent;
  x: number;
  y: number;
  walking: boolean;
  carry: boolean;
  phase: number;
  screen: "off" | "work" | "think";
  queued: number;
  bubble: string;
  /** O que o monitor da mesa mostra: o trabalho, as últimas ações e a situação. */
  desk?: AgentScreen;
  /** Sentado fora da mesa (no sofá), em pixels da sala; facing 0 = olhando para +z. */
  sit?: { x: number; y: number; facing: number } | null;
}
export interface AgentScreen {
  state: "livre" | "trabalhando" | "pensando" | "esperando" | "erro";
  title: string;
  lines: string[];
  /** Pedido feito no chat da tarefa (não pelo Escritório). */
  chat: boolean;
}
export interface FrameView {
  t: number;
  dt: number;
  /** Uma janela cobre a sala: ela anda devagar de propósito (não conta para a qualidade adaptativa). */
  background?: boolean;
  player: { x: number; y: number; moving: boolean; phase: number };
  agents: AgentView[];
  delivered: number;
  unread: number;
  guide: OfficeAgent | null;
  prompt: string;
  /** O que o telão mostra: uma linha por agente e os totais. */
  monitor: { rows: { name: string; color: string; text: string; busy: boolean }[]; totals: string };
}

// ---------------- Materiais e peças ----------------

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, o: { rough?: number; metal?: number; emissive?: string; flat?: boolean } = {}) {
  const key = `${color}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.emissive ?? ""}|${o.flat ?? true}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.8,
      metalness: o.metal ?? 0,
      flatShading: o.flat ?? true,
      ...(o.emissive ? { emissive: new THREE.Color(o.emissive), emissiveIntensity: 1 } : {}),
    });
    materials.set(key, m);
  }
  return m;
}
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
function roundedBox(w: number, h: number, d: number, r: number, m: THREE.Material) {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - r, bevelEnabled: true, bevelSize: r / 2, bevelThickness: r / 2, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - r) / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Caixa invisível para o clique: a mesa de verdade é juntada com o resto da sala (ver bake).
const HIT = new THREE.MeshBasicMaterial({ visible: false });
function hitBox(g: THREE.Object3D, w: number, h: number, d: number, y = h / 2, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIT);
  m.position.set(0, y, z);
  m.userData.dynamic = true;
  g.add(m);
}

// ---------------- Móveis ----------------

const WOOD = "#9b7451", WOOD_DARK = "#6e4d33", BOSS_WOOD = "#5a3622";

const glow = (color: string, intensity = 2.5) =>
  new THREE.MeshStandardMaterial({ color: "#111111", emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4 });

function makePlant(): THREE.Group {
  const g = new THREE.Group();
  const pot = cyl(0.22, 0.16, 0.36, mat("#b5653a"), 10);
  pot.position.y = 0.18;
  g.add(pot);
  g.add(at(cyl(0.2, 0.2, 0.03, mat("#4a3423"), 10), 0, 0.35, 0));
  const leaves = mat("#3f8f47");
  const leaves2 = mat("#5aa85a");
  for (const [x, y, z, s, m] of [
    [0, 0.72, 0, 0.3, leaves],
    [0.14, 0.58, 0.06, 0.2, leaves2],
    [-0.13, 0.6, -0.05, 0.22, leaves2],
    [0.02, 0.95, 0.02, 0.18, leaves2],
  ] as [number, number, number, number, THREE.Material][]) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), m);
    leaf.position.set(x, y, z);
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}
// Mesa de reunião: tampo de madeira escura com borda e 8 cadeiras do Call, 4 de cada lado,
// viradas para a mesa. Os lugares batem com meetingSeats (o personagem senta à frente do assento).
function makeMeetingTable(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.55 });
  const metal = mat("#16181d", { rough: 0.4, metal: 0.6 });
  g.add(box(3.7, 0.06, 1.25, wood, 0, 0.75, 0));
  g.add(box(3.72, 0.03, 1.27, mat("#3b2a1f"), 0, 0.715, 0));
  for (const x of [-1.5, 1.5]) {
    g.add(box(0.08, 0.7, 0.9, metal, x, 0.36, 0));
    g.add(box(0.12, 0.03, 1.0, metal, x, 0.015, 0));
  }
  // Um notebook e papéis no meio, para a mesa não ficar vazia.
  g.add(box(0.36, 0.015, 0.26, mat("#d9d9d9"), -0.4, 0.79, 0.1), box(0.34, 0.015, 0.25, mat("#ffffff"), 0.6, 0.79, -0.15));
  g.add(box(0.42, 0.02, 0.3, mat("#1f2937", { metal: 0.4 }), 0.1, 0.79, 0.12));
  const SIT = 0.23 * S;
  for (let i = 0; i < 4; i++)
    for (const side of [-1, 1]) {
      const chair = makeChair("#3a4b63");
      chair.scale.setScalar(S);
      // Em cima (side -1) a pessoa olha para +z: o encosto fica do outro lado.
      chair.position.set(-1.5 + i, 0, side * (0.95 + SIT));
      if (side < 0) chair.rotation.y = Math.PI;
      g.add(chair);
    }
  return g;
}

function makeSofa(): THREE.Group {
  const g = new THREE.Group();
  const fabric = mat("#6d597a"), dark = mat("#584866");
  g.add(box(2.6, 0.3, 0.8, dark, 0, 0.25, 0));
  for (const x of [-0.85, 0, 0.85]) g.add(roundedBox(0.82, 0.16, 0.66, 0.06, fabric).translateX(x).translateY(0.46).translateZ(0.05));
  g.add(roundedBox(2.6, 0.55, 0.2, 0.08, fabric).translateY(0.62).translateZ(-0.32));
  for (const x of [-1.32, 1.32]) g.add(roundedBox(0.2, 0.5, 0.8, 0.06, dark).translateX(x).translateY(0.45));
  return g;
}
function makeShelf(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(WOOD_DARK);
  g.add(box(1.7, 1.3, 0.42, wood, 0, 0.65, -0.1));
  const inner = mat("#4f3826");
  for (const y of [0.35, 0.85]) g.add(box(1.56, 0.42, 0.36, inner, 0, y, -0.06));
  const colors = ["#e07a5f", "#3d85c6", "#e9c46a", "#2a9d8f", "#9b5de5", "#ef476f", "#f4a261"];
  for (const [shelf, y] of [[0, 0.17], [1, 0.67]] as const)
    for (let i = 0; i < 9; i++) {
      const h = 0.26 + ((i * 7 + shelf * 3) % 5) * 0.025;
      const b = box(0.13, h, 0.28, mat(colors[(i + shelf * 2) % colors.length]), -0.68 + i * 0.165, y + h / 2, -0.04);
      if (i === 6 && shelf === 1) b.rotation.z = 0.25;
      g.add(b);
    }
  return g;
}
function makeCooler(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.42, 0.9, 0.42, mat("#e6ebee", { rough: 0.4 }), 0, 0.45, 0));
  g.add(box(0.08, 0.06, 0.06, mat("#3d85c6"), -0.08, 0.7, 0.23));
  g.add(box(0.08, 0.06, 0.06, mat("#c1121f"), 0.08, 0.7, 0.23));
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.5, 14),
    new THREE.MeshPhysicalMaterial({ color: "#7cc6ef", transparent: true, opacity: 0.7, roughness: 0.1, transmission: 0.3 }),
  );
  bottle.position.y = 1.15;
  g.add(bottle);
  return g;
}
function boardTexture(name: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const x = c.getContext("2d");
  if (x) {
    x.fillStyle = "#f7f7f2";
    x.fillRect(0, 0, 512, 160);
    x.fillStyle = "#2a9d8f";
    x.font = "bold 34px system-ui";
    x.textAlign = "center";
    x.fillText("PROJETO", 256, 56);
    x.fillStyle = "#264653";
    x.font = "bold 46px system-ui";
    const text = name.length > 22 ? `${name.slice(0, 21)}…` : name || "escolha um";
    x.fillText(text, 256, 118);
    x.strokeStyle = "#e07a5f";
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(140, 134);
    x.lineTo(372, 134);
    x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeBoard(name: string, onWall: boolean): { group: THREE.Group; face: THREE.Mesh } {
  const g = new THREE.Group();
  g.add(box(2.7, 0.95, 0.06, mat(WOOD_DARK), 0, 0, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 0.82), new THREE.MeshStandardMaterial({ map: boardTexture(name), roughness: 0.5 }));
  face.position.z = 0.035;
  g.add(face);
  g.add(box(1.2, 0.05, 0.1, mat("#bbbbbb", { metal: 0.3, rough: 0.4 }), 0, -0.5, 0.05));
  if (!onWall)
    for (const x of [-1.2, 1.2]) g.add(box(0.06, 1.4, 0.06, mat(WOOD_DARK), x, -0.75, -0.02));
  return { group: g, face };
}
function makeBossDesk(): { group: THREE.Group; papers: THREE.Group } {
  const g = new THREE.Group();
  const wood = mat(BOSS_WOOD, { rough: 0.5 });
  g.add(box(2.7, 0.1, 1.1, wood, 0, 0.74, 0));
  g.add(box(2.6, 0.68, 0.06, mat("#4a2b1a"), 0, 0.36, 0.5));
  for (const x of [-1.2, 1.2]) g.add(box(0.3, 0.68, 1.0, mat("#4a2b1a"), x, 0.36, 0));
  g.add(box(0.62, 0.05, 0.42, mat("#c9a227", { metal: 0.6, rough: 0.35 }), -0.75, 0.81, -0.05));
  const papers = new THREE.Group();
  papers.userData.dynamic = true;
  papers.position.set(-0.75, 0.84, -0.05);
  g.add(papers);
  const lamp = new THREE.Group();
  lamp.position.set(1.0, 0.79, -0.2);
  lamp.add(cyl(0.1, 0.12, 0.04, mat("#2d2d33")));
  lamp.add(at(cyl(0.02, 0.02, 0.4, mat("#2d2d33")), 0, 0.2, 0));
  lamp.add(at(cyl(0.06, 0.15, 0.14, mat("#2a9d8f")), 0, 0.42, 0));
  g.add(lamp);
  g.add(box(0.5, 0.04, 0.34, mat("#2d2d33", { rough: 0.4 }), 0.1, 0.81, -0.1));
  const lid = box(0.5, 0.32, 0.03, mat("#2d2d33", { rough: 0.4 }), 0.1, 0.97, -0.27);
  lid.rotation.x = -0.25;
  g.add(lid);
  const plate = box(0.5, 0.1, 0.04, mat("#c9a227", { metal: 0.6, rough: 0.35 }), 0.1, 0.84, 0.48);
  g.add(plate);
  return { group: g, papers };
}
function setPapers(stack: THREE.Group, n: number) {
  if (stack.children.length === Math.min(n, 8)) return;
  stack.clear();
  for (let i = 0; i < Math.min(n, 8); i++) {
    const p = box(0.36, 0.015, 0.26, mat(i % 2 ? "#f1f1f1" : "#ffffff"), (i % 3) * 0.01, i * 0.018, 0);
    p.rotation.y = ((i * 37) % 9 - 4) * 0.02;
    stack.add(p);
  }
}

// ---------------- Monitor de cada agente ----------------

const SCREEN_STATE: Record<AgentScreen["state"], { label: string; color: string }> = {
  livre: { label: "Livre", color: "#64748b" },
  trabalhando: { label: "Trabalhando", color: "#2dd4bf" },
  pensando: { label: "Pensando", color: "#a78bfa" },
  esperando: { label: "Esperando sua aprovação", color: "#f59e0b" },
  erro: { label: "Deu problema", color: "#ef4444" },
};

function clipText(x: CanvasRenderingContext2D, text: string, max: number) {
  if (x.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && x.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

// O que o agente está fazendo, como uma tela de verdade: barra com o estado, o trabalho e as
// últimas ações em fonte de terminal, com o cursor piscando enquanto trabalha.
function drawAgentScreen(c: HTMLCanvasElement, name: string, d: AgentScreen, blink: boolean) {
  const x = c.getContext("2d");
  if (!x) return;
  const W = c.width, H = c.height;
  const st = SCREEN_STATE[d.state];
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0e1522");
  bg.addColorStop(1, "#080b12");
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#141c2b";
  x.fillRect(0, 0, W, 40);
  x.fillStyle = st.color;
  x.beginPath();
  x.arc(22, 20, 7, 0, 7);
  x.fill();
  x.font = "600 17px system-ui, sans-serif";
  x.textBaseline = "middle";
  x.fillStyle = "#e8ebf1";
  x.fillText(clipText(x, `${name} · ${st.label}`, W - (d.chat ? 150 : 50)), 38, 21);
  if (d.chat) {
    x.fillStyle = "rgba(56, 189, 248, 0.18)";
    x.beginPath();
    x.roundRect(W - 104, 9, 92, 24, 12);
    x.fill();
    x.fillStyle = "#7dd3fc";
    x.font = "600 13px system-ui, sans-serif";
    x.textAlign = "center";
    x.fillText("pelo chat", W - 58, 22);
    x.textAlign = "left";
  }
  if (d.state === "livre" && !d.title) {
    x.fillStyle = "#475569";
    x.font = "500 22px system-ui, sans-serif";
    x.textAlign = "center";
    x.fillText("Esperando um pedido", W / 2, H / 2 + 14);
    x.textAlign = "left";
    return;
  }
  x.fillStyle = "#f8fafc";
  x.font = "600 19px system-ui, sans-serif";
  x.fillText(clipText(x, d.title, W - 36), 18, 66);
  if (d.state === "esperando") {
    x.fillStyle = "rgba(245, 158, 11, 0.16)";
    x.fillRect(12, 84, W - 24, 30);
    x.fillStyle = "#fbbf24";
    x.font = "600 15px system-ui, sans-serif";
    x.fillText("✋ Esperando você permitir ou negar", 22, 99);
  }
  x.font = "14px Consolas, 'Cascadia Mono', monospace";
  const top = d.state === "esperando" ? 132 : 100;
  const lines = d.lines.slice(-Math.floor((H - top - 6) / 22));
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    x.fillStyle = last ? "#cbd5e1" : "#64748b";
    const text = clipText(x, `› ${line}`, W - 40);
    x.fillText(text, 18, top + i * 22);
    if (last && blink && d.state === "trabalhando") {
      x.fillStyle = st.color;
      x.fillRect(22 + x.measureText(text).width, top + i * 22 - 8, 9, 16);
    }
  });
}

// ---------------- Telão ----------------

function drawMonitor(c: HTMLCanvasElement, m: FrameView["monitor"], t: number) {
  const x = c.getContext("2d");
  if (!x) return;
  const W = c.width, H = c.height;
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d1b2e");
  bg.addColorStop(1, "#081221");
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#4cc9f0";
  x.font = "bold 30px system-ui";
  x.textAlign = "left";
  x.fillText("CONTROLE DA EQUIPE", 28, 46);
  x.fillStyle = Math.sin(t * 3) > 0 ? "#06d6a0" : "#048a67";
  x.beginPath();
  x.arc(W - 40, 36, 9, 0, 7);
  x.fill();
  x.fillStyle = "#8fb3d9";
  x.font = "18px system-ui";
  x.textAlign = "right";
  x.fillText("AO VIVO", W - 58, 43);
  x.textAlign = "left";
  const rowH = Math.min(46, (H - 120) / Math.max(1, m.rows.length));
  m.rows.forEach((r, i) => {
    const y = 78 + i * rowH;
    x.fillStyle = i % 2 ? "#ffffff08" : "#ffffff12";
    x.fillRect(20, y, W - 40, rowH - 6);
    x.fillStyle = r.color;
    x.beginPath();
    x.arc(42, y + rowH / 2 - 3, 9, 0, 7);
    x.fill();
    x.fillStyle = "#ffffff";
    x.font = "bold 22px system-ui";
    x.fillText(r.name, 62, y + rowH / 2 + 4);
    x.fillStyle = r.busy ? "#ffd166" : "#9fb7cf";
    x.font = "19px system-ui";
    const text = r.text.length > 46 ? r.text.slice(0, 45) + "…" : r.text;
    x.fillText(text, 220, y + rowH / 2 + 4);
  });
  x.fillStyle = "#cfe8ff";
  x.font = "bold 20px system-ui";
  x.fillText(m.totals, 28, H - 22);
}

function makeScreen(): { group: THREE.Group; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const g = new THREE.Group();
  g.add(box(3.7, 1.25, 0.1, mat("#0c0d10", { rough: 0.3, metal: 0.4 }), 0, 0, 0));
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(3.56, 1.12),
    new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.9, roughness: 0.3 }),
  );
  face.position.z = 0.055;
  g.add(face);
  // Fita de LED embaixo, como num estúdio.
  g.add(box(3.6, 0.02, 0.03, glow("#4cc9f0", 2.5), 0, -0.66, 0.04));
  return { group: g, canvas, texture };
}

// ---------------- Cena ----------------

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private room = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private floor: THREE.Mesh;
  private walls: { mesh: THREE.Object3D; cells: { x: number; z: number }[]; faded: boolean }[] = [];
  private desks = new Map<string, AgentDesk>();
  private bossPapers: THREE.Group | null = null;
  private bossScreen: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; drawn: string } | null = null;
  private bossModel: DeskModel | null = null;
  private bossAnchor = new THREE.Vector3();
  private boardFace: THREE.Mesh | null = null;
  private monitors: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }[] = [];
  private monitorDrawn = -1;
  private people = new Map<string, Actor>();
  private looks = new WeakMap<OfficeAgent, { look: ReturnType<typeof agentLook>; key: string }>();
  /** Modo edição: câmera de cima, grade no chão, prévia de onde o item vai e o item escolhido. */
  private editOn = false;
  private editCenter = new THREE.Vector3();
  private editGrid: THREE.LineSegments | null = null;
  private editGhost = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  private editSel = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xfbbf24 }),
  );
  private saved = { pitch: 0.92, distance: 8.5 };
  private player: Actor | null = null;
  private screensDrawn = -1;
  private guideCone: THREE.Mesh;
  private guideLine: THREE.Line;
  private layout: OfficeLayout | null = null;
  private projectName = "";
  private labels = new Map<string, HTMLDivElement>();
  private raycaster = new THREE.Raycaster();
  private wallFade = mat("#93a4c0").clone();
  /** Câmera: ângulo em volta do chefe, inclinação e distância. */
  private maxRatio = 1;
  private lastFrame = 0;
  private fastTime = 0;
  /** Medição para o desenvolvimento: tempo dentro da cena e o pior quadro do segundo. */
  private sceneMs = 0;
  private sceneMax = 0;
  private worst = 0;
  /** Escala máxima para o tamanho atual (o teto de pixels). */
  private cap = 1;
  private ratio = 1;
  private frames = 0;
  private slowTime = 0;
  private sampleTime = 0;
  private sampleFrames = 0;
  yaw = 0;
  pitch = 0.92;
  distance = 8.5;
  private look = new THREE.Vector3();
  private placed = false;
  private heading = Math.PI;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLDivElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.ratio = this.maxRatio;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.shadowMap.enabled = true;
    // Sombra com borda simples: a suave amostra várias vezes cada pixel da tela.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Sombra recalculada só quando algo se mexe (ver render).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = T.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Luz e cores do escritório do Golfinho Call: sala escura, luz quente de cima e um recorte
    // ciano vindo das janelas. Sem pós-processamento: LEDs e telas brilham por material.
    this.scene.background = new THREE.Color(T.bg);
    this.scene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);
    this.wallFade.transparent = true;
    this.wallFade.opacity = 0.18;
    this.wallFade.depthWrite = false;
    this.scene.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
    const sun = new THREE.DirectionalLight(T.key[0], T.key[1]);
    sun.position.set(8, 14, 10);
    sun.target.position.set(12.5, 0, 8);
    sun.castShadow = true;
    // 1024 basta para a sala (a sombra é só o contato no chão); 2048 custa 4x a cada atualização.
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(T.rim[0], T.rim[1]);
    rim.position.set(-10, 6, -20);
    this.scene.add(rim);

    const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.02;
    outside.receiveShadow = true;
    this.scene.add(outside);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor, this.room);

    this.editGhost.visible = this.editSel.visible = false;
    this.editGhost.renderOrder = this.editSel.renderOrder = 5;
    this.scene.add(this.editGhost, this.editSel);
    // Os modelos dos personagens começam a baixar já: a sala abre sem engasgar.
    preloadAvatars();
    // Sombra de verdade só no que é fixo: o mapa é desenhado uma vez por sala. Quem anda tem a
    // sombra de contato (como no Golfinho Call), e andar não redesenha nada.
    AVATAR_OPTIONS.castShadow = false;
    PET_OPTIONS.castShadow = false;
    this.guideCone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), mat("#ffd166", { emissive: "#b88a10" }));
    this.guideCone.rotation.x = Math.PI;
    this.guideCone.visible = false;
    this.scene.add(this.guideCone);
    this.guideLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: "#ffd166", dashSize: 0.3, gapSize: 0.2 }),
    );
    this.guideLine.visible = false;
    this.scene.add(this.guideLine);
  }

  setLayout(layout: OfficeLayout, projectName: string) {
    if (layout === this.layout && projectName === this.projectName) return;
    const roomChanged = layout !== this.layout;
    this.layout = layout;
    this.projectName = projectName;
    if (!roomChanged && this.boardFace) {
      (this.boardFace.material as THREE.MeshStandardMaterial).map = boardTexture(projectName);
      return;
    }
    this.room.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.room.clear();
    this.pickables = [];
    this.walls = [];
    this.monitors = [];
    this.monitorDrawn = -1;
    for (const d of this.desks.values()) {
      d.model.dispose();
      d.screen.texture.dispose();
    }
    this.desks.clear();
    this.screensDrawn = -1;
    this.bossModel?.dispose();
    this.bossScreen?.texture.dispose();
    this.bossModel = null;
    this.bossScreen = null;
    if (this.editGrid) {
      this.scene.remove(this.editGrid);
      this.editGrid.geometry.dispose();
    }
    const lines: number[] = [];
    for (let c = 0; c <= layout.cols; c++) lines.push(c, 0.03, 0, c, 0.03, layout.rows);
    for (let r = 0; r <= layout.rows; r++) lines.push(0, 0.03, r, layout.cols, 0.03, r);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    this.editGrid = new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.editGrid.visible = this.editOn;
    this.scene.add(this.editGrid);
    this.floor.scale.set(layout.cols, layout.rows, 1);
    this.floor.position.set(layout.cols / 2, 0, layout.rows / 2);
    this.buildTiles(layout);
    for (const f of layout.furniture) this.buildFurniture(layout, f);
    for (const a of layout.agents) this.buildDesk(a);
    this.bake();
    this.renderer.shadowMap.needsUpdate = true;
    for (const [id, p] of this.people)
      if (!layout.agents.some((a) => a.id === id && p.key === lookKey(agentLook(a)))) {
        this.dropActor(p);
        this.people.delete(id);
      }
    const boss = bossLook(layout);
    if (!this.player || this.player.key !== lookKey(boss)) {
      if (this.player) this.dropActor(this.player);
      this.player = this.makeActor(boss, { kind: "boss" });
    }
  }

  // Tudo o que não se mexe vira uma malha por material: de centenas de desenhos por quadro para
  // algumas dezenas. Ficam de fora as partes marcadas como dinâmicas (fans, papéis, paredes que
  // ficam transparentes, caixas de clique) e as malhas instanciadas do piso.
  private bake() {
    this.room.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const baked: THREE.Mesh[] = [];
    this.room.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material)) return;
      if ((o.material as THREE.Material).vertexColors || o instanceof THREE.SkinnedMesh) return;
      for (let p: THREE.Object3D | null = o; p && p !== this.room; p = p.parent) if (p.userData.dynamic) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.morphAttributes = {};
      g.clearGroups();
      const list = buckets.get(o.material) ?? [];
      list.push(g);
      buckets.set(o.material, list);
      baked.push(o);
    });
    for (const m of baked) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    for (const [material, list] of buckets) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      this.room.add(mesh);
    }
  }

  // Piso de madeira escura numa peça só (a textura corre pela sala inteira); tapete e azulejo
  // por cima, por célula. Paredes grafite; as janelas mostram a cidade à noite.
  private buildTiles(l: OfficeLayout) {
    const wood = new THREE.CanvasTexture(woodCanvas());
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(l.cols / 3, l.rows / 3);
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(l.cols, l.rows), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.78, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(l.cols / 2, 0, l.rows / 2);
    floor.receiveShadow = true;
    floor.userData.dynamic = true;
    this.room.add(floor);
    const kinds: Record<string, { h: number; colors: number[]; rough: number }> = {
      c: { h: 0.02, colors: [T.rugs[0], 0x183540], rough: 1 },
      t: { h: 0.015, colors: [0x2a3140, 0x262c39], rough: 0.4 },
    };
    const geo = new THREE.BoxGeometry(0.98, 1, 0.98);
    for (const [code, spec] of Object.entries(kinds)) {
      const cells: [number, number][] = [];
      for (let row = 0; row < l.rows; row++)
        for (let col = 0; col < l.cols; col++) if (l.tiles[row * l.cols + col] === code) cells.push([col, row]);
      if (!cells.length) continue;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: spec.rough }), cells.length);
      const m = new THREE.Matrix4();
      const color = new THREE.Color();
      cells.forEach(([col, row], i) => {
        m.compose(new THREE.Vector3(col + 0.5, spec.h / 2, row + 0.5), new THREE.Quaternion(), new THREE.Vector3(1, spec.h, 1));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.set(spec.colors[(col * 7 + row * 3) % spec.colors.length]));
      });
      mesh.receiveShadow = true;
      this.room.add(mesh);
    }
    // Mureta baixa em volta da sala, para ela não terminar no vazio.
    const rim = mat("#1b2230", { rough: 0.9 });
    this.room.add(
      box(l.cols + 0.2, 0.35, 0.1, rim, l.cols / 2, 0.175, l.rows + 0.05),
      box(0.1, 0.35, l.rows, rim, -0.05, 0.175, l.rows / 2),
      box(0.1, 0.35, l.rows, rim, l.cols + 0.05, 0.175, l.rows / 2),
    );
    const wallM = new THREE.MeshStandardMaterial({ color: T.wall, roughness: 0.92 });
    const trim = new THREE.MeshStandardMaterial({ color: T.frame, roughness: 0.6 });
    // A cidade corre pelas janelas: cada vidro mostra 1/8 da imagem (o recorte vai na UV, para
    // todos os vidros dividirem um material e se juntarem numa malha só).
    const city = new THREE.CanvasTexture(cityCanvas());
    city.colorSpace = THREE.SRGBColorSpace;
    city.wrapS = THREE.RepeatWrapping;
    const view = new THREE.MeshBasicMaterial({ map: city, toneMapped: false });
    // Paredes em blocos de 4x4 células, cada bloco juntado numa malha por material: de ~300
    // desenhos por quadro para algumas dezenas. A parede que tapa o chefe some pelo bloco.
    const blocks = new Map<string, { group: THREE.Group; cells: { x: number; z: number }[] }>();
    for (let row = 0; row < l.rows; row++)
      for (let col = 0; col < l.cols; col++) {
        const tile = tileAt(l, { col, row });
        if (!isWallTile(tile)) continue;
        const key = `${Math.floor(col / 4)}:${Math.floor(row / 4)}`;
        let block = blocks.get(key);
        if (!block) blocks.set(key, (block = { group: new THREE.Group(), cells: [] }));
        const g = new THREE.Group();
        g.position.set(col + 0.5, 0, row + 0.5);
        if (tile === "parede") {
          g.add(box(1, 2.4, 1, wallM, 0, 1.2, 0));
        } else {
          g.add(box(1, 0.75, 1, wallM, 0, 0.375, 0));
          g.add(box(1, 0.35, 1, wallM, 0, 2.225, 0));
          const glass = new THREE.BoxGeometry(1, 1.3, 0.06);
          const uv = glass.attributes.uv as THREE.BufferAttribute;
          const slice = (col + row) % 8;
          for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) + slice) / 8);
          const pane = new THREE.Mesh(glass, view);
          pane.position.set(0, 1.4, 0);
          g.add(pane);
          g.add(box(0.06, 1.3, 0.1, trim, 0.47, 1.4, 0), box(1, 0.05, 0.12, trim, 0, 0.77, 0), box(1, 0.05, 0.12, trim, 0, 2.03, 0));
        }
        g.add(box(1.02, 0.1, 1.02, trim, 0, 0.05, 0));
        block.group.add(g);
        block.cells.push({ x: col + 0.5, z: row + 0.5 });
      }
    for (const block of blocks.values()) {
      const merged = mergeByMaterial(block.group);
      merged.userData.dynamic = true;
      this.room.add(merged);
      this.walls.push({ mesh: merged, cells: block.cells, faded: false });
    }
  }

  private buildFurniture(l: OfficeLayout, f: Furniture) {
    const { w, h } = FOOTPRINT[f.kind];
    const cx = f.col + w / 2, cz = f.row + h / 2;
    let g: THREE.Object3D;
    if (f.kind === "planta") g = callPlant(0.75);
    else if (f.kind === "sofa") {
      // O sofá do Call tem o encosto para +z; aqui o encosto fica no fundo (-z), como antes.
      const sofa = callSofa(T.sofa);
      sofa.scale.setScalar(S * 0.9);
      sofa.rotation.y = Math.PI;
      g = new THREE.Group().add(sofa);
    }
    else if (f.kind === "estante") g = makeShelf();
    else if (f.kind === "bebedouro") g = makeCooler();
    else if (f.kind === "chefe") {
      this.buildBossDesk(f);
      return;
    } else if (f.kind === "reuniao") {
      g = makeMeetingTable();
      g.userData.target = { kind: "reuniao", id: f.id } satisfies PickTarget;
      hitBox(g, 4, 1, 3, 0.5);
      this.pickables.push(g);
    } else if (f.kind === "telao") {
      const onWall = isWallTile(tileAt(l, { col: f.col, row: f.row }));
      const screen = makeScreen();
      screen.group.position.set(cx, onWall ? 1.55 : 1.6, onWall ? f.row + 1.06 : cz);
      if (!onWall)
        for (const x of [-1.6, 1.6]) screen.group.add(box(0.07, 1.6, 0.07, mat("#2a2c33", { metal: 0.6, rough: 0.4 }), x, -0.8, -0.03));
      screen.group.userData.target = { kind: "telao", id: f.id } satisfies PickTarget;
      hitBox(screen.group, 3.7, 1.3, 0.3, 0);
      this.pickables.push(screen.group);
      this.monitors.push(screen);
      this.room.add(screen.group);
      return;
    } else {
      const onWall = isWallTile(tileAt(l, { col: f.col, row: f.row }));
      const board = makeBoard(this.projectName, onWall);
      g = board.group;
      this.boardFace = board.face;
      g.position.set(cx, onWall ? 1.45 : 1.5, onWall ? f.row + 1.04 : cz);
      g.userData.target = { kind: "board" } satisfies PickTarget;
      hitBox(g, 2.7, 1.0, 0.3, 0);
      this.pickables.push(g);
      this.room.add(g);
      return;
    }
    g.position.set(cx, 0, cz);
    this.room.add(g);
  }

  // Mesa do Golfinho Call (o setup que a pessoa montou no editor), com a cadeira e o monitor
  // principal mostrando o trabalho do agente. Atrás da tela, um brilho na cor da situação.
  private buildDesk(a: OfficeAgent) {
    const outer = new THREE.Group();
    outer.position.set(a.desk.col + 1.5, 0, a.desk.row + DESK_Z);
    const inner = new THREE.Group();
    inner.scale.setScalar(S);
    outer.add(inner);
    const model = buildDesk(agentDesk(a), a.color, a.name);
    inner.add(model.group);
    if (!model.chair) {
      const chair = makeChair(a.color);
      chair.position.set(0, 0, 1.25);
      inner.add(chair);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(screenGeometry(model.curved, MONITOR_W, MONITOR_H), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.set(model.mainX, MONITOR_Y, -0.07);
    inner.add(screen);
    const glowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MONITOR_W * 2, MONITOR_H * 2.4),
      new THREE.MeshBasicMaterial({ map: softGlow(), color: 0x2dd4bf, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glowMesh.position.set(model.mainX, MONITOR_Y, -0.18);
    glowMesh.userData.dynamic = true;
    inner.add(glowMesh);
    const papers = new THREE.Group();
    papers.userData.dynamic = true;
    papers.position.set(model.width / 2 - 0.35, 0.8, 0.55);
    inner.add(papers);
    outer.userData.target = { kind: "agent", id: a.id } satisfies PickTarget;
    hitBox(outer, 3, 1.6, 2, 0.8, 0.5);
    this.pickables.push(outer);
    this.room.add(outer);
    this.desks.set(a.id, {
      model,
      key: deskKey(agentDesk(a)),
      screen: { canvas, texture, drawn: "" },
      glow: glowMesh,
      papers,
      seat: new THREE.Vector3(a.desk.col + 1.5, 0, a.desk.row + SIT_Z),
    });
  }

  // Mesa do chefe: o setup gamer grande do Call, virado para o lugar do chefe (acima da mesa, na
  // planta). As entregas empilham no tampo; o PC e os monitores abrem o chat da tarefa.
  private buildBossDesk(f: Furniture) {
    const outer = new THREE.Group();
    outer.position.set(f.col + 1.5, 0, f.row + 1.4);
    const inner = new THREE.Group();
    inner.scale.setScalar(S);
    inner.rotation.y = Math.PI;
    outer.add(inner);
    const model = buildDesk(BOSS_DESK, 0xfbbf24, "Chefe");
    inner.add(model.group);
    if (!model.chair) {
      const chair = makeChair("#fbbf24");
      chair.position.set(0, 0, 1.25);
      inner.add(chair);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(screenGeometry(model.curved, MONITOR_W, MONITOR_H), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.set(model.mainX, MONITOR_Y, -0.07);
    inner.add(screen);
    this.bossScreen = { canvas, texture, drawn: "" };
    const papers = new THREE.Group();
    papers.userData.dynamic = true;
    papers.position.set(model.width / 2 - 0.45, 0.8, 0.45);
    inner.add(papers);
    this.bossPapers = papers;
    // A mesa (entregas) e, por cima, o PC e os monitores (o chat): o clique pega o mais perto.
    outer.userData.target = { kind: "boss" } satisfies PickTarget;
    hitBox(outer, 3, 0.95, 1.6, 0.48, -0.2);
    const pc = new THREE.Group();
    pc.userData.target = { kind: "bosspc" } satisfies PickTarget;
    hitBox(pc, 2.6, 0.95, 0.5, 1.45 * S + 0.05, 0);
    pc.position.set(0, 0, 0.05);
    outer.add(pc);
    this.pickables.push(pc, outer);
    this.bossModel = model;
    this.room.add(outer);
    this.bossAnchor.set(f.col + 1.5, 1.75, f.row + 1.2);
  }

  /** O que a tela do chefe mostra: o chat da tarefa que está andando, ou o convite para abrir. */
  setBossScreen(title: string, line: string, live: boolean) {
    const sc = this.bossScreen;
    if (!sc) return;
    const key = `${title}|${line}|${live}`;
    if (key === sc.drawn) return;
    sc.drawn = key;
    const x = sc.canvas.getContext("2d");
    if (!x) return;
    const W = sc.canvas.width, H = sc.canvas.height;
    const bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0e1522");
    bg.addColorStop(1, "#080b12");
    x.fillStyle = bg;
    x.fillRect(0, 0, W, H);
    x.fillStyle = "#141c2b";
    x.fillRect(0, 0, W, 40);
    x.fillStyle = live ? "#38bdf8" : "#64748b";
    x.beginPath();
    x.arc(22, 20, 7, 0, 7);
    x.fill();
    x.font = "600 17px system-ui, sans-serif";
    x.textBaseline = "middle";
    x.fillStyle = "#e8ebf1";
    x.fillText("💬 Chat do Golfinho", 38, 21);
    x.fillStyle = "#f8fafc";
    x.font = "600 22px system-ui, sans-serif";
    x.fillText(clipText(x, title, W - 36), 18, 92);
    x.fillStyle = "#94a3b8";
    x.font = "16px system-ui, sans-serif";
    x.fillText(clipText(x, line, W - 36), 18, 130);
    x.fillStyle = "#38bdf8";
    x.font = "600 15px system-ui, sans-serif";
    x.fillText("Clique no PC para abrir a conversa", 18, H - 30);
    sc.texture.needsUpdate = true;
  }

  // Personagem do Call num suporte: o suporte olha para +z com rotação 0, como o resto da sala
  // (o personagem do Call olha para -z). O pet, se tiver, segue o dono pela sala.
  private makeActor(look: ReturnType<typeof agentLook>, target: PickTarget): Actor {
    const holder = new THREE.Group();
    const character = new Character(look);
    character.root.rotation.y = Math.PI;
    holder.add(character.root);
    holder.scale.setScalar(S);
    holder.traverse((o) => (o.userData.target = target));
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ map: softGlow(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.012;
    holder.add(contact);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.26), mat("#ffffff"));
    paper.position.set(0, 1.05, 0.32);
    paper.rotation.x = -0.5;
    paper.visible = false;
    holder.add(paper);
    this.scene.add(holder);
    const petModel = makePet(look.pet, look.petColor, look.led);
    let pet: PetFollower | null = null;
    if (petModel) {
      petModel.group.scale.setScalar(S);
      this.scene.add(petModel.group);
      pet = new PetFollower(petModel);
      pet.setLed(look.led, look.ledMode);
    }
    return { holder, character, key: lookKey(look), seated: false, pet, paper, speed: 0, heading: 0, placed: false };
  }

  private dropActor(a: Actor) {
    this.scene.remove(a.holder);
    a.character.dispose();
    if (a.pet) {
      this.scene.remove(a.pet.pet.group);
      a.pet.pet.dispose();
    }
  }

  private actor(a: OfficeAgent): Actor {
    let p = this.people.get(a.id);
    // A aparência só muda quando a sala muda (outro objeto de agente): calcula uma vez por objeto.
    let cached = this.looks.get(a);
    if (!cached) {
      const look = agentLook(a);
      cached = { look, key: lookKey(look) };
      this.looks.set(a, cached);
    }
    const { look } = cached;
    if (!p || p.key !== cached.key) {
      if (p) this.dropActor(p);
      p = this.makeActor(look, { kind: "agent", id: a.id });
      this.people.set(a.id, p);
    }
    return p;
  }

  /** Anda (ou fica parado em pé) até o ponto; devolve a velocidade em unidades por segundo. */
  private moveActor(p: Actor, x: number, z: number, moving: boolean, dt: number) {
    const pos = p.holder.position;
    if (p.seated) {
      p.seated = false;
      p.character.setSeated(false);
    }
    const dx = x - pos.x, dz = z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (moving && dist > 0.001) p.heading = Math.atan2(dx, dz);
    const speed = p.placed && dt > 0 ? Math.min(8, dist / dt) : 0;
    p.placed = true;
    pos.set(x, 0, z);
    p.holder.rotation.y = lerpAngle(p.holder.rotation.y, p.heading, Math.min(1, dt * 12));
    p.speed += (speed - p.speed) * Math.min(1, dt * 10);
  }

  private seatActor(p: Actor, seat: THREE.Vector3) {
    if (!p.seated) {
      p.seated = true;
      p.character.setSeated(true);
    }
    p.holder.position.copy(seat);
    p.holder.rotation.y = p.heading = Math.PI;
    p.speed = 0;
    p.placed = true;
  }

  private animateActor(p: Actor, dt: number, t: number, talking: boolean) {
    p.character.update(dt, p.speed / S, talking);
    if (p.pet) {
      const pos = p.holder.position;
      // O pet usa a direção do Call (rotação 0 olhando para -z).
      p.pet.update(dt, t, { x: pos.x, z: pos.z, ry: p.holder.rotation.y + Math.PI, seated: p.seated });
    }
  }

  /** Liga ou desliga o modo edição (câmera de cima, centrada na sala). */
  setEditing(on: boolean) {
    if (on === this.editOn) return;
    this.editOn = on;
    if (this.editGrid) this.editGrid.visible = on;
    if (on) {
      this.saved = { pitch: this.pitch, distance: this.distance };
      const l = this.layout;
      this.editCenter.set(l ? l.cols / 2 : 12.5, 0, l ? l.rows / 2 : 8);
      this.pitch = 1.12;
      this.distance = 19;
    } else {
      this.pitch = this.saved.pitch;
      this.distance = this.saved.distance;
      this.editGhost.visible = this.editSel.visible = false;
    }
  }

  /** Move a câmera da edição pelo chão (unidades da sala), sem sair da sala. */
  panEdit(dx: number, dz: number) {
    const l = this.layout;
    if (!l) return;
    this.editCenter.x = Math.min(l.cols, Math.max(0, this.editCenter.x + dx));
    this.editCenter.z = Math.min(l.rows, Math.max(0, this.editCenter.z + dz));
  }

  /** Prévia de onde o item vai (verde cabe, vermelho não) e o contorno do item escolhido. */
  editOverlay(o: { ghost: { col: number; row: number; w: number; h: number; ok: boolean; tile: boolean } | null; selected: { col: number; row: number; w: number; h: number } | null }) {
    const g = o.ghost;
    this.editGhost.visible = Boolean(g);
    if (g) {
      const height = g.tile ? 0.06 : 0.9;
      this.editGhost.scale.set(g.w - 0.06, height, g.h - 0.06);
      this.editGhost.position.set(g.col + g.w / 2, height / 2 + 0.02, g.row + g.h / 2);
      (this.editGhost.material as THREE.MeshBasicMaterial).color.set(g.ok ? 0x2dd4bf : 0xef4444);
    }
    const sel = o.selected;
    this.editSel.visible = Boolean(sel);
    if (sel) {
      this.editSel.scale.set(sel.w + 0.08, 1.4, sel.h + 0.08);
      this.editSel.position.set(sel.col + sel.w / 2, 0.7, sel.row + sel.h / 2);
    }
  }

  /** Direções da câmera no chão, em pixels da sala: para onde W e D levam o chefe. */
  basis() {
    return {
      forward: { x: -Math.sin(this.yaw), y: -Math.cos(this.yaw) },
      right: { x: Math.cos(this.yaw), y: -Math.sin(this.yaw) },
    };
  }
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.005;
    this.pitch = Math.min(1.35, Math.max(0.25, this.pitch + dy * 0.006));
  }
  zoom(delta: number) {
    this.distance = Math.min(this.editOn ? 30 : 14, Math.max(3.2, this.distance * (delta > 0 ? 1.1 : 0.9)));
  }

  /** Ponto do chão sob o mouse (em pixels da sala), atravessando móveis e pessoas; null fora da sala. */
  floorPoint(clientX: number, clientY: number): Point | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    const l = this.layout;
    if (!hit || !l || hit.x < 0 || hit.z < 0 || hit.x >= l.cols || hit.z >= l.rows) return null;
    return { x: hit.x * CELL, y: hit.z * CELL };
  }

  pick(clientX: number, clientY: number): Pick {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pickables, ...[...this.people.values()].map((p) => p.holder)], true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.target) o = o.parent;
      if (o?.userData.target) return { target: o.userData.target as PickTarget, floor: null };
    }
    const floor = this.raycaster.intersectObject(this.floor)[0];
    return { target: null, floor: floor ? { x: floor.point.x * CELL, y: floor.point.z * CELL } : null };
  }

  render(v: FrameView) {
    if (!this.layout) return;
    const started = performance.now();
    try {
      this.draw(v);
    } finally {
      const spent = performance.now() - started;
      this.sceneMs += spent;
      this.sceneMax = Math.max(this.sceneMax, spent);
    }
  }

  private draw(v: FrameView) {
    if (!this.layout) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // Teto de pixels por quadro: em tela cheia a resolução interna baixa para caber nele, e o
    // quadro custa quase o mesmo que na janela (a diferença de nitidez quase não se nota).
    if (w && h) {
      this.cap = Math.max(0.5, Math.min(this.maxRatio, Math.sqrt(PIXEL_BUDGET / (w * h))));
      if (this.ratio > this.cap) this.ratio = this.cap;
    }
    if (v.background) this.lastFrame = 0;
    else this.adapt(v.player.moving || v.agents.some((a) => a.walking));
    if (w && h && (this.canvas.width !== Math.floor(w * this.ratio) || this.camera.aspect !== w / h)) {
      this.renderer.setPixelRatio(this.ratio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.frames++;
    // Chefe.
    const px = U(v.player.x), pz = U(v.player.y);
    if (this.player) {
      this.moveActor(this.player, px, pz, v.player.moving, v.dt);
      this.animateActor(this.player, v.dt, v.t, false);
    }
    // Agentes: sentados no computador, ou andando pela sala (levando a entrega).
    const screensTick = Math.floor(v.t * 2);
    const redraw = screensTick !== this.screensDrawn;
    if (redraw) this.screensDrawn = screensTick;
    for (const a of v.agents) {
      const p = this.actor(a.agent);
      const desk = this.desks.get(a.agent.id);
      if (a.sit) {
        this.seatActor(p, new THREE.Vector3(U(a.sit.x), 0, U(a.sit.y)));
        p.holder.rotation.y = p.heading = a.sit.facing;
      } else if (a.walking || !desk) this.moveActor(p, U(a.x), U(a.y), a.walking, v.dt);
      else this.seatActor(p, desk.seat);
      p.paper.visible = a.carry && a.walking;
      const talking = Boolean(a.bubble) && !/^(⚙️|🤔)/u.test(a.bubble);
      this.animateActor(p, v.dt, v.t + a.phase, talking);
      if (desk) {
        desk.model.update(v.t);
        const info: AgentScreen = a.desk ?? { state: a.screen === "work" ? "trabalhando" : a.screen === "think" ? "pensando" : "livre", title: "", lines: [], chat: false };
        const st = SCREEN_STATE[info.state];
        const glowMat = desk.glow.material as THREE.MeshBasicMaterial;
        glowMat.color.set(st.color);
        glowMat.opacity = info.state === "livre" ? 0 : info.state === "esperando" ? 0.35 + Math.sin(v.t * 5) * 0.2 : 0.38;
        // A tela redesenha só quando muda (ou para o cursor piscar), no máximo duas vezes por segundo.
        if (redraw) {
          const blink = info.state === "trabalhando" && screensTick % 2 === 0;
          const key = JSON.stringify([info, blink, a.agent.name]);
          if (key !== desk.screen.drawn) {
            desk.screen.drawn = key;
            drawAgentScreen(desk.screen.canvas, a.agent.name, info, blink);
            desk.screen.texture.needsUpdate = true;
          }
        }
        setPapers(desk.papers, a.queued);
      }
    }
    if (this.bossPapers) setPapers(this.bossPapers, v.delivered);
    this.bossModel?.update(v.t);
    // Guia até quem cuida do pedido encaminhado.
    if (v.guide) {
      const gx = v.guide.desk.col + 1.5, gz = v.guide.desk.row + SIT_Z;
      this.guideCone.visible = true;
      this.guideCone.position.set(gx, 2.05 + Math.sin(v.t * 5) * 0.12, gz);
      this.guideCone.rotation.y = v.t * 2;
      const front = new THREE.Vector3(v.guide.desk.col + 1.5, 0.08, v.guide.desk.row + 2.5);
      this.guideLine.geometry.setFromPoints([new THREE.Vector3(px, 0.08, pz), front]);
      this.guideLine.computeLineDistances();
      (this.guideLine.material as THREE.LineDashedMaterial).dashSize = 0.3;
      this.guideLine.visible = true;
    } else this.guideCone.visible = this.guideLine.visible = false;
    // Câmera em terceira pessoa: atrás e acima do chefe, com suavização.
    // Olha um pouco à frente do chefe: dá para ver para onde ele está indo.
    const ahead = this.basis().forward;
    const target = this.editOn ? this.editCenter.clone() : new THREE.Vector3(px + U(ahead.x * 60), 0.9, pz + U(ahead.y * 60));
    if (!this.placed) {
      this.look.copy(target);
      this.placed = true;
    } else this.look.lerp(target, Math.min(1, v.dt * 8));
    const horizontal = Math.cos(this.pitch) * this.distance;
    const want = new THREE.Vector3(
      this.look.x + Math.sin(this.yaw) * horizontal,
      this.look.y + Math.sin(this.pitch) * this.distance,
      this.look.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.position.lerp(want, this.camera.position.lengthSq() ? Math.min(1, v.dt * 8) : 1);
    this.camera.lookAt(this.look);
    // Parede entre a câmera e o chefe fica transparente (só mexe quando muda).
    const cx = this.camera.position.x, cz = this.camera.position.z;
    for (const wall of this.walls) {
      const blocking = !this.editOn && wall.cells.some((c) => segmentDistance(c.x, c.z, cx, cz, px, pz) < 0.9 && Math.hypot(c.x - px, c.z - pz) > 0.6);
      if (blocking === wall.faded) continue;
      wall.faded = blocking;
      wall.mesh.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.material instanceof THREE.MeshPhysicalMaterial) return;
        if (blocking) {
          o.userData.solid ??= o.material;
          o.material = this.wallFade;
          o.castShadow = false;
        } else if (o.userData.solid) {
          o.material = o.userData.solid;
          o.castShadow = true;
        }
      });
    }
    // O telão redesenha duas vezes por segundo: basta para o "ao vivo" e não pesa.
    const tick = Math.floor(v.t * 2);
    if (this.monitors.length && tick !== this.monitorDrawn) {
      this.monitorDrawn = tick;
      for (const m of this.monitors) {
        drawMonitor(m.canvas, v.monitor, v.t);
        m.texture.needsUpdate = true;
      }
    }
    // Sombras: quem se mexe são as pessoas; recalcula a cada dois quadros enquanto alguém anda.
    // Sombras fixas: só a primeira passada depois de montar a sala (ver setLayout) e um retoque
    // de vez em quando, para o que anima na mesa (ventoinhas, aquário).
    if (this.frames % 600 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.drawLabels(v);
  }

  // Qualidade adaptativa: se os quadros passam de ~22 ms por um tempo, baixa um pouco a
  // resolução; se sobra folga, volta a subir até o máximo. O brilho e as sombras ficam.
  private adapt(moving: boolean) {
    // Tempo real entre quadros (o dt da sala é limitado a 50 ms e esconderia as travadas).
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.sampleTime += dt;
    this.sampleFrames++;
    this.worst = Math.max(this.worst, dt);
    if (this.sampleTime < 1) return;
    const avg = this.sampleTime / this.sampleFrames;
    const frames = this.sampleFrames;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    if (import.meta.env.DEV) {
      const r = this.renderer.info.render;
      console.warn(
        `[escritório 3D] ${Math.round(1 / avg)} quadros/s (${(avg * 1000).toFixed(1)} ms) · cena ${(this.sceneMs / frames).toFixed(1)} ms (pior ${this.sceneMax.toFixed(0)}) · pior quadro ${(this.worst * 1000).toFixed(0)} ms · ${this.canvas.width}x${this.canvas.height} (escala ${this.ratio.toFixed(2)}) · ${r.calls} desenhos`,
      );
    }
    this.sceneMs = this.sceneMax = this.worst = 0;
    // Resolução estável: trocar de nitidez no meio da corrida aparece como a imagem "embaçando".
    // Só baixa depois de 3 s seguidos lentos (uma travada isolada não é a placa de vídeo) e só
    // volta a subir com folga por 4 s e com o chefe parado.
    if (avg > 0.15) {
      this.slowTime = this.fastTime = 0;
    } else if (avg > 0.024) {
      this.fastTime = 0;
      if (++this.slowTime >= 3 && this.ratio > MIN_RATIO) {
        this.ratio = Math.max(MIN_RATIO, this.ratio - 0.1);
        this.slowTime = 0;
      }
    } else if (avg < 0.012 && !moving) {
      this.slowTime = 0;
      if (++this.fastTime >= 4 && this.ratio < this.cap) {
        this.ratio = Math.min(this.cap, this.ratio + 0.1);
        this.fastTime = 0;
      }
    } else this.slowTime = this.fastTime = 0;
  }

  // Nomes, balões, o aviso de entregas e o "[E] Falar com": HTML por cima do canvas.
  private drawLabels(v: FrameView) {
    const used = new Set<string>();
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight;
    const place = (key: string, className: string, text: string, at: THREE.Vector3) => {
      const p = at.clone().project(this.camera);
      if (p.z > 1 || p.z < -1) return;
      let el = this.labels.get(key);
      if (!el) {
        el = document.createElement("div");
        this.overlay.appendChild(el);
        this.labels.set(key, el);
      }
      if (el.className !== className) el.className = className;
      if (el.textContent !== text) {
        el.textContent = text;
        // Medir força o navegador a recalcular a página: só quando o texto muda.
        el.dataset.w = String(el.offsetWidth);
        el.dataset.h = String(el.offsetHeight);
      }
      // Preso dentro da tela: um balão de quem está no fundo não some pela borda de cima.
      const half = Math.min(110, Number(el.dataset.w) / 2 || 40);
      const x = Math.round(Math.min(w - half - 4, Math.max(half + 4, ((p.x + 1) / 2) * w)));
      const y = Math.round(Math.min(h - 4, Math.max((Number(el.dataset.h) || 20) + 4, ((1 - p.y) / 2) * h)));
      const transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      if (el.style.transform !== transform) el.style.transform = transform;
      used.add(key);
    };
    for (const a of v.agents) {
      const p = this.people.get(a.agent.id);
      place(`name:${a.agent.id}`, "office3d-name", `${a.agent.name} · ${a.agent.role}`, new THREE.Vector3(a.agent.desk.col + 1.5, 0.1, a.agent.desk.row + 1.98));
      if (a.bubble && p) place(`bubble:${a.agent.id}`, "office3d-bubble", a.bubble, p.holder.position.clone().add(new THREE.Vector3(0, p.seated ? 1.3 : 1.6, 0)));
    }
    if (v.unread) place("unread", "office3d-badge", String(v.unread), this.bossAnchor);
    if (v.prompt && this.player) place("prompt", "office3d-prompt", v.prompt, this.player.holder.position.clone().add(new THREE.Vector3(0, 1.7, 0)));
    for (const [key, el] of this.labels)
      if (!used.has(key)) {
        el.remove();
        this.labels.delete(key);
      }
  }

  dispose() {
    for (const p of this.people.values()) this.dropActor(p);
    if (this.player) this.dropActor(this.player);
    for (const d of this.desks.values()) {
      d.model.dispose();
      d.screen.texture.dispose();
    }
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.renderer.dispose();
  }
}

/** Junta as malhas de um grupo numa por material (posições já aplicadas). */
function mergeByMaterial(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    const list = buckets.get(o.material) ?? [];
    list.push(g);
    buckets.set(o.material, list);
    o.geometry.dispose();
  });
  const out = new THREE.Group();
  for (const [material, list] of buckets) {
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = !(material as THREE.Material).transparent && !(material instanceof THREE.MeshBasicMaterial);
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

/** O setup do chefe: mesa grande, dois monitores, LED RGB, teclado gamer, PC vitrine e neon. */
const BOSS_DESK: DeskStyle = {
  ...DEFAULT_DESK,
  size: "grande",
  wood: "preto",
  monitors: 2,
  leds: "rgb",
  ledColor: "#fbbf24",
  keyboard: "gamer",
  lamp: false,
  headphones: true,
  speakers: true,
  chair: "gamer",
  pc: "grande",
  neon: "onair",
  trophy: true,
};

interface AgentDesk {
  model: DeskModel;
  key: string;
  screen: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; drawn: string };
  glow: THREE.Mesh;
  papers: THREE.Group;
  /** Onde o personagem fica quando está sentado. */
  seat: THREE.Vector3;
}
interface Actor {
  holder: THREE.Group;
  character: Character;
  key: string;
  seated: boolean;
  pet: PetFollower | null;
  paper: THREE.Mesh;
  /** Velocidade suavizada (unidades por segundo) e a direção para onde olha. */
  speed: number;
  heading: number;
  placed: boolean;
}

let glowTexture: THREE.Texture | null = null;
/** Mancha redonda e suave (o brilho atrás do monitor). */
function softGlow(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const len = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
