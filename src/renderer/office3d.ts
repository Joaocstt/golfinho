// Escritório em 3D (three.js): a mesma sala em grade, desenhada em low-poly com luz e sombras,
// e a câmera em terceira pessoa atrás do chefe. A lógica (colisão, caminhos, quem está fazendo o
// quê) continua em pixels 2D em officeGame; aqui 1 célula de 40 px vira 1 unidade do mundo.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Furniture, OfficeAgent, OfficeLayout } from "../shared/office";
import { CELL, FOOTPRINT, isWallTile, tileAt } from "../shared/officeLayout";
import type { Point } from "./officeGame";

const U = (px: number) => px / CELL;
const SKIN = "#f1c8a0";

export type PickTarget = { kind: "agent"; id: string } | { kind: "boss" } | { kind: "board" } | { kind: "telao"; id: string };
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
}
export interface FrameView {
  t: number;
  dt: number;
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

// ---------------- Pessoa low-poly ----------------

interface Person {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  paper: THREE.Mesh;
  key: string;
}
function makePerson(shirt: string, hair: string, o: { suit?: boolean } = {}): Person {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const pants = mat(o.suit ? "#1f2a44" : "#3a3f4b");
  const shirtM = mat(shirt);
  const skin = mat(SKIN);
  const limb = (m: THREE.Material, len: number, r: number) => {
    const g = new THREE.Group();
    const part = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - r * 2, 3, 8), m);
    part.position.y = -len / 2;
    part.castShadow = true;
    g.add(part);
    return g;
  };
  const legL = limb(pants, 0.42, 0.07), legR = limb(pants, 0.42, 0.07);
  legL.position.set(-0.08, 0.44, 0);
  legR.position.set(0.08, 0.44, 0);
  const shoeM = mat("#2b2b2b");
  for (const leg of [legL, legR]) leg.add(box(0.13, 0.06, 0.2, shoeM, 0, -0.42, 0.04));
  body.add(legL, legR);
  const torso = roundedBox(0.36, 0.4, 0.22, 0.08, o.suit ? mat("#22305a") : shirtM);
  torso.position.y = 0.66;
  body.add(torso);
  if (o.suit) {
    body.add(box(0.12, 0.3, 0.01, mat("#f4f4f4"), 0, 0.7, 0.115));
    body.add(box(0.05, 0.24, 0.012, mat("#c1121f"), 0, 0.68, 0.122));
  }
  const armM = o.suit ? mat("#22305a") : shirtM;
  const armL = limb(armM, 0.36, 0.055), armR = limb(armM, 0.36, 0.055);
  armL.position.set(-0.235, 0.83, 0);
  armR.position.set(0.235, 0.83, 0);
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
    hand.position.y = -0.37;
    hand.castShadow = true;
    arm.add(hand);
  }
  body.add(armL, armR);
  const neck = cyl(0.05, 0.05, 0.06, skin, 8);
  neck.position.y = 0.89;
  body.add(neck);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), skin);
  head.position.y = 1.04;
  head.castShadow = true;
  body.add(head);
  const hairM = mat(hair);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hairM);
  cap.position.y = 1.06;
  cap.rotation.x = -0.25;
  cap.castShadow = true;
  body.add(cap);
  const back = box(0.3, 0.14, 0.06, hairM, 0, 1.02, -0.12);
  body.add(back);
  const eyeM = mat("#1d1d1d");
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), eyeM);
    eye.position.set(x, 1.05, 0.148);
    body.add(eye);
  }
  const paper = box(0.2, 0.26, 0.02, mat("#ffffff"), 0, 0.68, 0.2);
  paper.rotation.x = -0.4;
  paper.visible = false;
  body.add(paper);
  return { root, body, legL, legR, armL, armR, paper, key: `${shirt}|${hair}|${o.suit ? 1 : 0}` };
}
function posePerson(p: Person, o: { moving: boolean; phase: number; seated: boolean; carry: boolean; t: number }) {
  const swing = o.moving ? Math.sin(o.phase) * 0.6 : 0;
  if (o.seated) {
    p.legL.rotation.x = p.legR.rotation.x = -1.45;
    p.body.position.y = 0.02;
    p.armL.rotation.x = p.armR.rotation.x = -1.1 + Math.sin(o.t * 9) * 0.05;
  } else {
    p.body.position.y = o.moving ? Math.abs(Math.sin(o.phase)) * 0.04 : Math.sin(o.t * 2) * 0.008;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armL.rotation.x = o.carry ? -1.2 : -swing * 0.8;
    p.armR.rotation.x = o.carry ? -1.2 : swing * 0.8;
  }
  p.paper.visible = o.carry;
}

// ---------------- Móveis ----------------

const WOOD = "#9b7451", WOOD_DARK = "#6e4d33", BOSS_WOOD = "#5a3622";

// Setup gamer de cada agente: mesa preta com fita de LED, dois monitores em ângulo (o rosto de
// quem senta fica à vista entre eles), teclado e mousepad iluminados, gabinete com vidro e fans
// RGB no chão, headset no suporte. Os materiais de luz são da mesa, para animar a cor.
interface Desk {
  group: THREE.Group;
  papers: THREE.Group;
  /** Luz RGB que fica trocando de cor (fitas finas) e a versão fraca (teclado, mousepad). */
  rgb: THREE.MeshStandardMaterial;
  soft: THREE.MeshStandardMaterial;
  /** Luz de estado: atrás dos monitores, nas telas e no logo do gabinete. */
  status: THREE.MeshStandardMaterial;
  screens: THREE.MeshStandardMaterial;
  fans: THREE.Object3D[];
}
const glow = (color: string, intensity = 2.5) =>
  new THREE.MeshStandardMaterial({ color: "#111111", emissive: new THREE.Color(color), emissiveIntensity: intensity, roughness: 0.4 });

function makeDesk(): Desk {
  const g = new THREE.Group();
  const rgb = glow("#ff00aa", 1.6);
  const soft = glow("#ff00aa", 0.35);
  const status = glow("#0b1520", 0.4);
  const screens = new THREE.MeshStandardMaterial({ color: "#0a0f18", emissive: new THREE.Color("#1b2a44"), emissiveIntensity: 0.8, roughness: 0.2 });
  const carbon = mat("#17181d", { rough: 0.35, metal: 0.2 });
  const metal = mat("#2a2c33", { rough: 0.35, metal: 0.7 });
  const plastic = mat("#0e0f12", { rough: 0.45 });

  // Tampo e pés em T, com a fita de LED na borda da frente e embaixo.
  g.add(box(2.4, 0.06, 0.95, carbon, 0, 0.72, 0));
  g.add(box(2.4, 0.014, 0.02, rgb, 0, 0.695, 0.48));
  for (const x of [-1.1, 1.1]) {
    g.add(box(0.07, 0.68, 0.1, metal, x, 0.35, 0));
    g.add(box(0.08, 0.04, 0.86, metal, x, 0.02, 0));
    g.add(box(0.012, 0.6, 0.012, rgb, x + (x > 0 ? -0.04 : 0.04), 0.36, 0.05));
  }
  g.add(box(2.1, 0.05, 0.05, metal, 0, 0.62, -0.38));

  // Mousepad grande com borda de LED, teclado com luz por baixo das teclas e mouse.
  g.add(box(1.32, 0.008, 0.4, mat("#121318", { rough: 0.95 }), 0, 0.755, -0.24));
  g.add(box(1.32, 0.006, 0.008, soft, 0, 0.758, -0.04));
  g.add(box(1.32, 0.006, 0.008, soft, 0, 0.758, -0.44));
  g.add(box(0.58, 0.03, 0.19, plastic, -0.12, 0.775, -0.25));
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.15), soft);
  keys.rotation.x = -Math.PI / 2;
  keys.position.set(-0.12, 0.792, -0.25);
  g.add(keys);
  for (let r = 0; r < 4; r++)
    g.add(box(0.5, 0.012, 0.025, plastic, -0.12, 0.797, -0.305 + r * 0.037));
  const mouse = roundedBox(0.06, 0.035, 0.1, 0.015, plastic);
  mouse.position.set(0.35, 0.775, -0.25);
  g.add(mouse);
  g.add(box(0.02, 0.004, 0.03, rgb, 0.35, 0.795, -0.23));

  // Dois monitores em ângulo, virados para quem senta. Atrás, uma fita com a luz de estado.
  for (const side of [-1, 1]) {
    const m = new THREE.Group();
    m.position.set(side * 0.62, 0, 0.08);
    m.rotation.y = side * -0.38;
    m.add(box(0.24, 0.014, 0.16, metal, 0, 0.757, 0.02));
    m.add(box(0.04, 0.26, 0.04, metal, 0, 0.88, 0.06));
    m.add(roundedBox(0.7, 0.4, 0.035, 0.012, plastic).translateY(1.12));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.36), screens);
    screen.position.set(0, 1.12, -0.024);
    screen.rotation.y = Math.PI;
    m.add(screen);
    m.add(box(0.5, 0.02, 0.006, status, 0, 1.17, 0.022));
    m.add(box(0.5, 0.02, 0.006, status, 0, 1.06, 0.022));
    g.add(m);
  }

  // Headset no suporte, à esquerda.
  const stand = new THREE.Group();
  stand.position.set(-1.0, 0.75, 0.22);
  stand.add(box(0.14, 0.012, 0.14, metal, 0, 0.006, 0));
  stand.add(at(cyl(0.012, 0.012, 0.3, metal), 0, 0.15, 0));
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 6, 14, Math.PI), plastic);
  band.position.y = 0.3;
  band.castShadow = true;
  stand.add(band);
  for (const x of [-0.09, 0.09]) {
    const cup = cyl(0.045, 0.045, 0.04, plastic, 12);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(x, 0.24, 0);
    stand.add(cup);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 4, 14), rgb);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x + (x > 0 ? 0.022 : -0.022), 0.24, 0);
    stand.add(ring);
  }
  g.add(stand);

  // Gabinete no chão, ao lado da mesa, com o vidro virado para a sala.
  const tower = new THREE.Group();
  tower.position.set(1.34, 0, 0.12);
  tower.add(box(0.24, 0.62, 0.5, plastic, 0, 0.33, 0));
  for (const x of [-0.08, 0.08]) for (const z of [-0.18, 0.18]) tower.add(box(0.04, 0.02, 0.04, metal, x, 0.01, z));
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.56),
    new THREE.MeshPhysicalMaterial({ color: "#1a2030", transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }),
  );
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.121, 0.34, 0);
  tower.add(glass);
  tower.add(box(0.005, 0.5, 0.42, mat("#06070a"), 0.1, 0.34, 0));
  const fans: THREE.Object3D[] = [];
  for (const y of [0.2, 0.36, 0.52]) {
    const fan = new THREE.Group();
    fan.position.set(0.1, y, -0.15);
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.009, 6, 18), rgb);
    ringMesh.rotation.y = Math.PI / 2;
    fan.add(ringMesh);
    for (let i = 0; i < 3; i++) {
      const blade = box(0.004, 0.08, 0.018, mat("#1c1f27"), 0, 0, 0);
      blade.rotation.x = (i / 3) * Math.PI;
      blade.castShadow = false;
      fan.add(blade);
    }
    fan.userData.dynamic = true;
    tower.add(fan);
    fans.push(fan);
  }
  tower.add(box(0.03, 0.05, 0.24, status, 0.1, 0.3, 0.1));
  tower.add(box(0.03, 0.03, 0.03, rgb, 0.005, 0.58, 0.26));
  g.add(tower);

  // Latinha de energético.
  const can = cyl(0.033, 0.033, 0.12, mat("#2ec4b6", { rough: 0.3, metal: 0.6 }), 12);
  can.position.set(0.78, 0.81, -0.18);
  g.add(can);

  const papers = new THREE.Group();
  papers.userData.dynamic = true;
  papers.position.set(0.98, 0.76, 0.18);
  g.add(papers);
  return { group: g, papers, rgb, soft, status, screens, fans };
}

// Cadeira gamer, com as faixas na cor do agente.
function makeChair(accent = "#e63946"): THREE.Group {
  const g = new THREE.Group();
  const black = mat("#16171c", { rough: 0.6 });
  const stripe = mat(accent, { rough: 0.55 });
  const metal = mat("#2a2c33", { rough: 0.35, metal: 0.7 });
  g.add(roundedBox(0.54, 0.1, 0.5, 0.04, black).translateY(0.47));
  g.add(box(0.1, 0.012, 0.44, stripe, -0.16, 0.527, 0));
  g.add(box(0.1, 0.012, 0.44, stripe, 0.16, 0.527, 0));
  const back = roundedBox(0.52, 0.82, 0.1, 0.05, black);
  back.position.set(0, 0.95, -0.25);
  back.rotation.x = -0.1;
  g.add(back);
  for (const x of [-0.2, 0.2]) {
    const wing = box(0.1, 0.62, 0.1, black, x * 1.25, 0.9, -0.2);
    wing.rotation.x = -0.1;
    g.add(wing);
    const s = box(0.06, 0.7, 0.012, stripe, x * 0.75, 0.95, -0.193);
    s.rotation.x = -0.1;
    g.add(s);
  }
  const pillow = roundedBox(0.3, 0.12, 0.08, 0.03, stripe);
  pillow.position.set(0, 1.25, -0.2);
  g.add(pillow);
  for (const x of [-0.29, 0.29]) {
    g.add(box(0.04, 0.2, 0.04, metal, x, 0.6, -0.02));
    g.add(box(0.08, 0.03, 0.26, black, x, 0.71, 0.0));
  }
  g.add(at(cyl(0.035, 0.035, 0.32, metal), 0, 0.27, 0));
  for (let i = 0; i < 5; i++) {
    const leg = new THREE.Group();
    leg.rotation.y = (i / 5) * Math.PI * 2;
    leg.add(box(0.3, 0.035, 0.05, metal, 0.15, 0.07, 0));
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), black);
    wheel.position.set(0.3, 0.03, 0);
    leg.add(wheel);
    g.add(leg);
  }
  return g;
}

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
  private walls: { mesh: THREE.Object3D; x: number; z: number; faded: boolean }[] = [];
  private desks = new Map<string, Desk>();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bossPapers: THREE.Group | null = null;
  private bossAnchor = new THREE.Vector3();
  private boardFace: THREE.Mesh | null = null;
  private monitors: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }[] = [];
  private monitorDrawn = -1;
  private people = new Map<string, Person>();
  private player: Person;
  private guideCone: THREE.Mesh;
  private guideLine: THREE.Line;
  private layout: OfficeLayout | null = null;
  private projectName = "";
  private labels = new Map<string, HTMLDivElement>();
  private raycaster = new THREE.Raycaster();
  private wallFade = mat("#93a4c0").clone();
  /** Câmera: ângulo em volta do chefe, inclinação e distância. */
  private maxRatio = 1;
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.ratio = this.maxRatio;
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Sombra recalculada só quando algo se mexe, e no máximo a cada dois quadros.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Brilho (bloom) só no que emite luz: LEDs, fans e telas.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.35, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.scene.background = new THREE.Color("#1c2130");
    this.scene.fog = new THREE.Fog("#1c2130", 22, 48);
    this.wallFade.transparent = true;
    this.wallFade.opacity = 0.18;
    this.wallFade.depthWrite = false;

    const hemi = new THREE.HemisphereLight("#e8efff", "#7a6550", 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff0dc", 2.4);
    sun.position.set(6, 14, 12);
    sun.target.position.set(12.5, 0, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, near: 1, far: 40 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight("#bcd4ff", 0.5);
    fill.position.set(22, 8, -4);
    this.scene.add(fill);

    const outside = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat("#262c3b", { rough: 1 }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.02;
    outside.receiveShadow = true;
    this.scene.add(outside);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor, this.room);

    this.player = makePerson("#22305a", "#3b2a1a", { suit: true });
    this.scene.add(this.player.root);
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
    this.desks.clear();
    this.floor.scale.set(layout.cols, layout.rows, 1);
    this.floor.position.set(layout.cols / 2, 0, layout.rows / 2);
    this.buildTiles(layout);
    for (const f of layout.furniture) this.buildFurniture(layout, f);
    for (const a of layout.agents) this.buildDesk(a);
    this.bake();
    this.renderer.shadowMap.needsUpdate = true;
    for (const [id, p] of this.people)
      if (!layout.agents.some((a) => a.id === id && p.key === makeKey(a))) {
        this.scene.remove(p.root);
        this.people.delete(id);
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

  private buildTiles(l: OfficeLayout) {
    const kinds: Record<string, { y: number; h: number; colors: string[] }> = {
      f: { y: 0, h: 0.04, colors: ["#c8a77c", "#c19f73", "#cfae83", "#bd9a6e"] },
      c: { y: 0, h: 0.07, colors: ["#b4846c", "#ae7e66"] },
      t: { y: 0, h: 0.04, colors: ["#e8eef0", "#dfe7ea"] },
    };
    const geo = new THREE.BoxGeometry(0.98, 1, 0.98);
    for (const [code, spec] of Object.entries(kinds)) {
      const cells: [number, number][] = [];
      for (let row = 0; row < l.rows; row++)
        for (let col = 0; col < l.cols; col++) if (l.tiles[row * l.cols + col] === code) cells.push([col, row]);
      if (!cells.length) continue;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: code === "t" ? 0.35 : 0.85 }), cells.length);
      const m = new THREE.Matrix4();
      const color = new THREE.Color();
      cells.forEach(([col, row], i) => {
        m.compose(new THREE.Vector3(col + 0.5, spec.y + spec.h / 2 - 0.02, row + 0.5), new THREE.Quaternion(), new THREE.Vector3(1, spec.h, 1));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.set(spec.colors[(col * 7 + row * 3) % spec.colors.length]));
      });
      mesh.receiveShadow = true;
      this.room.add(mesh);
    }
    // Mureta baixa em volta da sala, para ela não terminar no vazio.
    const rim = mat("#7b8bab");
    this.room.add(
      box(l.cols + 0.2, 0.35, 0.1, rim, l.cols / 2, 0.175, l.rows + 0.05),
      box(0.1, 0.35, l.rows, rim, -0.05, 0.175, l.rows / 2),
      box(0.1, 0.35, l.rows, rim, l.cols + 0.05, 0.175, l.rows / 2),
    );
    // Rodapé sob o piso inteiro, para as frestas não mostrarem o vazio.
    const base = box(l.cols, 0.02, l.rows, mat("#8c7457"), l.cols / 2, -0.005, l.rows / 2);
    base.castShadow = false;
    this.room.add(base);
    const wallM = mat("#93a4c0", { rough: 0.9 });
    const trim = mat("#7b8bab");
    const glass = new THREE.MeshPhysicalMaterial({ color: "#a9d6f5", emissive: "#5f9fd0", emissiveIntensity: 0.5, transparent: true, opacity: 0.55, roughness: 0.05 });
    for (let row = 0; row < l.rows; row++)
      for (let col = 0; col < l.cols; col++) {
        const tile = tileAt(l, { col, row });
        if (!isWallTile(tile)) continue;
        const g = new THREE.Group();
        g.position.set(col + 0.5, 0, row + 0.5);
        if (tile === "parede") {
          g.add(box(1, 2.4, 1, wallM, 0, 1.2, 0));
        } else {
          g.add(box(1, 0.9, 1, wallM, 0, 0.45, 0));
          g.add(box(1, 0.4, 1, wallM, 0, 2.2, 0));
          const pane = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.1, 0.08), glass);
          pane.position.set(0, 1.45, 0);
          g.add(pane);
          g.add(box(1, 0.06, 1.04, trim, 0, 0.92, 0));
        }
        g.add(box(1.02, 0.12, 1.02, trim, 0, 0.06, 0));
        g.userData.dynamic = true;
        this.room.add(g);
        this.walls.push({ mesh: g, x: col + 0.5, z: row + 0.5, faded: false });
      }
  }

  private buildFurniture(l: OfficeLayout, f: Furniture) {
    const { w, h } = FOOTPRINT[f.kind];
    const cx = f.col + w / 2, cz = f.row + h / 2;
    let g: THREE.Object3D;
    if (f.kind === "planta") g = makePlant();
    else if (f.kind === "sofa") g = makeSofa();
    else if (f.kind === "estante") g = makeShelf();
    else if (f.kind === "bebedouro") g = makeCooler();
    else if (f.kind === "chefe") {
      const boss = makeBossDesk();
      g = boss.group;
      this.bossPapers = boss.papers;
      g.userData.target = { kind: "boss" } satisfies PickTarget;
      hitBox(g, 2.8, 1.1, 1.2);
      this.pickables.push(g);
      this.bossAnchor.set(cx - 0.75, 1.3, cz);
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

  private buildDesk(a: OfficeAgent) {
    const desk = makeDesk();
    desk.group.position.set(a.desk.col + 1.5, 0, a.desk.row + 1.3);
    desk.group.userData.target = { kind: "agent", id: a.id } satisfies PickTarget;
    hitBox(desk.group, 3, 1.4, 2, 0.7, -0.3);
    this.pickables.push(desk.group);
    this.room.add(desk.group);
    const chair = makeChair(a.color);
    chair.position.set(a.desk.col + 1.5, 0, a.desk.row + 0.45);
    chair.rotation.y = 0;
    this.room.add(chair);
    this.desks.set(a.id, desk);
  }

  private person(a: OfficeAgent): Person {
    let p = this.people.get(a.id);
    if (!p || p.key !== makeKey(a)) {
      if (p) this.scene.remove(p.root);
      p = makePerson(a.color, a.hair);
      p.root.traverse((o) => (o.userData.target = { kind: "agent", id: a.id }));
      this.people.set(a.id, p);
      this.scene.add(p.root);
    }
    return p;
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
    this.distance = Math.min(14, Math.max(3.2, this.distance * (delta > 0 ? 1.1 : 0.9)));
  }

  pick(clientX: number, clientY: number): Pick {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.pickables, ...[...this.people.values()].map((p) => p.root)], true);
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
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.adapt(v.dt);
    if (w && h && (this.canvas.width !== Math.floor(w * this.ratio) || this.camera.aspect !== w / h)) {
      this.renderer.setPixelRatio(this.ratio);
      this.renderer.setSize(w, h, false);
      this.composer.setPixelRatio(this.ratio);
      this.composer.setSize(w, h);
      // O brilho em meia resolução: ninguém nota, e é a parte mais cara do quadro.
      this.bloom.setSize(Math.round((w * this.ratio) / 2), Math.round((h * this.ratio) / 2));
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.frames++;
    // Chefe.
    const px = U(v.player.x), pz = U(v.player.y);
    const pp = this.player.root.position;
    if (v.player.moving) {
      const dx = px - pp.x, dz = pz - pp.z;
      if (Math.hypot(dx, dz) > 0.001) this.heading = Math.atan2(dx, dz);
    }
    pp.set(px, 0, pz);
    this.player.root.rotation.y = lerpAngle(this.player.root.rotation.y, this.heading, Math.min(1, v.dt * 12));
    posePerson(this.player, { moving: v.player.moving, phase: v.player.phase, seated: false, carry: false, t: v.t });
    // Agentes: sentados na cadeira, ou andando pela sala.
    for (const a of v.agents) {
      const p = this.person(a.agent);
      const desk = this.desks.get(a.agent.id);
      if (a.walking) {
        const nx = U(a.x), nz = U(a.y);
        const dx = nx - p.root.position.x, dz = nz - p.root.position.z;
        if (Math.hypot(dx, dz) > 0.001) p.root.rotation.y = Math.atan2(dx, dz);
        p.root.position.set(nx, 0, nz);
      } else {
        p.root.position.set(a.agent.desk.col + 1.5, 0, a.agent.desk.row + 0.5);
        p.root.rotation.y = 0;
      }
      posePerson(p, { moving: a.walking, phase: a.phase * 10, seated: !a.walking, carry: a.carry, t: v.t + a.phase });
      if (desk) {
        const hue = (v.t * 0.07 + a.phase * 0.13) % 1;
        desk.rgb.emissive.setHSL(hue, 1, 0.5);
        desk.soft.emissive.setHSL(hue, 1, 0.5);
        const pulse = 0.65 + Math.sin(v.t * 6 + a.phase) * 0.35;
        desk.status.emissive.set(a.screen === "work" ? "#4cc9f0" : a.screen === "think" ? "#ffd166" : a.agent.color);
        desk.status.emissiveIntensity = a.screen === "off" ? 0.35 : 1.2 + pulse * 1.0;
        desk.screens.emissive.set(a.screen === "work" ? "#2b6cb0" : a.screen === "think" ? "#8a6d1a" : "#1b2a44");
        for (const fan of desk.fans) fan.rotation.x += v.dt * (a.screen === "work" ? 18 : 7);
        setPapers(desk.papers, a.queued);
      }
    }
    if (this.bossPapers) setPapers(this.bossPapers, v.delivered);
    // Guia até quem cuida do pedido encaminhado.
    if (v.guide) {
      const gx = v.guide.desk.col + 1.5, gz = v.guide.desk.row + 0.55;
      this.guideCone.visible = true;
      this.guideCone.position.set(gx, 1.85 + Math.sin(v.t * 5) * 0.12, gz);
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
    const target = new THREE.Vector3(px + U(ahead.x * 60), 0.9, pz + U(ahead.y * 60));
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
      const blocking = segmentDistance(wall.x, wall.z, cx, cz, px, pz) < 0.9 && Math.hypot(wall.x - px, wall.z - pz) > 0.6;
      if (blocking === wall.faded) continue;
      wall.faded = blocking;
      this.renderer.shadowMap.needsUpdate = true;
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
    if ((v.player.moving || v.agents.some((a) => a.walking)) && this.frames % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
    this.drawLabels(v);
  }

  // Qualidade adaptativa: se os quadros passam de ~22 ms por um tempo, baixa um pouco a
  // resolução; se sobra folga, volta a subir até o máximo. O brilho e as sombras ficam.
  private adapt(dt: number) {
    this.sampleTime += dt;
    this.sampleFrames++;
    if (this.sampleTime < 1.5) return;
    const avg = this.sampleTime / this.sampleFrames;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    if (avg > 0.022 && this.ratio > 0.75) {
      this.slowTime++;
      if (this.slowTime >= 2) {
        this.ratio = Math.max(0.75, this.ratio - 0.25);
        this.slowTime = 0;
      }
    } else if (avg < 0.0145 && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio + 0.25);
      this.slowTime = 0;
    } else this.slowTime = 0;
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
      place(`name:${a.agent.id}`, "office3d-name", `${a.agent.name} · ${a.agent.role}`, new THREE.Vector3(a.agent.desk.col + 1.5, 0.1, a.agent.desk.row + 1.95));
      if (a.bubble && p) place(`bubble:${a.agent.id}`, "office3d-bubble", a.bubble, p.root.position.clone().add(new THREE.Vector3(0, a.walking ? 1.5 : 1.25, 0)));
    }
    if (v.unread) place("unread", "office3d-badge", String(v.unread), this.bossAnchor);
    if (v.prompt) place("prompt", "office3d-prompt", v.prompt, this.player.root.position.clone().add(new THREE.Vector3(0, 1.55, 0)));
    for (const [key, el] of this.labels)
      if (!used.has(key)) {
        el.remove();
        this.labels.delete(key);
      }
  }

  dispose() {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.renderer.dispose();
  }
}

const makeKey = (a: OfficeAgent) => `${a.color}|${a.hair}|0`;
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
