// Mesa do escritório 3D, montada a partir do estilo escolhido (apoiadores personalizam).
// Usada no escritório e na prévia de "Minha mesa". A tela compartilhada fica no monitor principal
// (o escritório põe o vídeo em `mainX`); o resto é móvel, luz e enfeite.
import * as THREE from "three";

export type LedMode = "off" | "fixo" | "rgb" | "pulsar";
export type Wood = "grafite" | "carvalho" | "nogueira" | "branco" | "preto";

export type PcModel = "off" | "mini" | "medio" | "grande";

export interface DeskStyle {
  size: "normal" | "grande";
  wood: Wood;
  monitors: 1 | 2;
  leds: LedMode;
  ledColor: string;
  keyboard: "padrao" | "gamer";
  lamp: boolean;
  plant: boolean;
  headphones: boolean;
  speakers: boolean;
  /** Cadeira gamer (no lugar da cadeira de escritório). */
  chair: "padrao" | "gamer";
  /** Gabinete gamer embaixo da mesa: pequeno (ITX), médio (ATX) ou grande (vitrine). */
  pc: PcModel;
  /** Monitor principal curvo. */
  curved: boolean;
  /** Placa de neon atrás dos monitores. */
  neon: NeonText;
  /** Prateleira atrás dos monitores (aparece se tiver algo nela). */
  books: boolean;
  trophy: boolean;
  figure: boolean;
  cactus: boolean;
  aquarium: boolean;
  /** Controle de videogame na mesa. */
  controller: boolean;
}

export type NeonText = "off" | "nome" | "gg" | "onair" | "janja";
export const NEON_TEXTS: { id: NeonText; label: string }[] = [
  { id: "off", label: "Sem neon" },
  { id: "nome", label: "Meu nome" },
  { id: "gg", label: "GG" },
  { id: "onair", label: "ON AIR" },
  { id: "janja", label: "Golfinho" },
];

export const DEFAULT_DESK: DeskStyle = {
  size: "normal", wood: "grafite", monitors: 1, leds: "off", ledColor: "#2dd4bf",
  keyboard: "padrao", lamp: true, plant: false, headphones: false, speakers: false,
  chair: "padrao", pc: "off", curved: false, neon: "off", books: false, trophy: false, figure: false, cactus: false, aquarium: false, controller: false,
};

export const WOODS: { id: Wood; label: string; base: string; grain: string }[] = [
  { id: "grafite", label: "Grafite", base: "#3a3f4b", grain: "#30343e" },
  { id: "carvalho", label: "Carvalho", base: "#b98b5b", grain: "#9c7247" },
  { id: "nogueira", label: "Nogueira", base: "#6b4a33", grain: "#563a27" },
  { id: "branco", label: "Branco", base: "#e7e5e0", grain: "#d9d6cf" },
  { id: "preto", label: "Preto fosco", base: "#16181d", grain: "#101216" },
];

/** Cor da pessoa (mesma conta do avatar: matiz pelo id) em número, para o 3D. */
export function accentFor(id: number): number {
  return new THREE.Color().setHSL(((id * 0.618034) % 1), 0.55, 0.45).getHex();
}

export const LED_COLORS = ["#2dd4bf", "#3b82f6", "#a855f7", "#ec4899", "#ef4444", "#f59e0b", "#22c55e", "#ffffff"];

/** Estilo salvo (JSON) → estilo válido (o que faltar fica no padrão). */
export function parseDesk(raw: unknown): DeskStyle {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  return {
    size: pick(r.size, ["normal", "grande"] as const, DEFAULT_DESK.size),
    wood: pick(r.wood, WOODS.map((w) => w.id), DEFAULT_DESK.wood),
    monitors: pick(r.monitors, [1, 2] as const, DEFAULT_DESK.monitors),
    leds: pick(r.leds, ["off", "fixo", "rgb", "pulsar"] as const, DEFAULT_DESK.leds),
    ledColor: typeof r.ledColor === "string" && /^#[0-9a-f]{6}$/i.test(r.ledColor) ? r.ledColor : DEFAULT_DESK.ledColor,
    keyboard: pick(r.keyboard, ["padrao", "gamer"] as const, DEFAULT_DESK.keyboard),
    lamp: typeof r.lamp === "boolean" ? r.lamp : DEFAULT_DESK.lamp,
    plant: r.plant === true,
    headphones: r.headphones === true,
    speakers: r.speakers === true,
    chair: pick(r.chair, ["padrao", "gamer"] as const, DEFAULT_DESK.chair),
    // Mesas salvas antes dos 3 modelos tinham pc: true (vira o médio).
    pc: r.pc === true ? "medio" : pick(r.pc, ["off", "mini", "medio", "grande"] as const, DEFAULT_DESK.pc),
    curved: r.curved === true,
    neon: pick(r.neon, NEON_TEXTS.map((n) => n.id), DEFAULT_DESK.neon),
    books: r.books === true,
    trophy: r.trophy === true,
    figure: r.figure === true,
    cactus: r.cactus === true,
    aquarium: r.aquarium === true,
    controller: r.controller === true,
  };
}

export interface DeskModel {
  group: THREE.Group;
  /** Onde fica o monitor principal (x) — a tela compartilhada aparece nele. */
  mainX: number;
  /** Largura do tampo (para a colisão). */
  width: number;
  /** Monitor principal curvo (a tela compartilhada usa screenGeometry(true)). */
  curved: boolean;
  /** Cadeira gamer (já posicionada no grupo); sem ela o escritório usa a cadeira comum. */
  chair?: THREE.Group;
  /** Altura da placa com o nome da mesa (sobe se tiver prateleira ou neon). */
  labelY: number;
  /** Anima LEDs, teclado e relógio do segundo monitor (t em segundos). */
  update(t: number): void;
  dispose(): void;
}

/** Raio da curva do monitor curvo (1800R, como os de verdade). */
export const CURVE_R = 1.8;

/** Entorta uma geometria em volta do eixo Y: as pontas vêm para a frente (+z). */
function bend<T extends THREE.BufferGeometry>(geo: T, r = CURVE_R): T {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const a = x / r;
    pos.setXYZ(i, Math.sin(a) * (r - z) + 0, pos.getY(i), z + (r - z) * (1 - Math.cos(a)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Geometria da tela do monitor principal (reta ou curva), com o mesmo UV do plano. */
export function screenGeometry(curved: boolean, w = 1.6, h = 0.9): THREE.BufferGeometry {
  return curved ? bend(new THREE.PlaneGeometry(w, h, 48, 1)) : new THREE.PlaneGeometry(w, h);
}

// Medidas do monitor principal (iguais às do escritório: a tela é encaixada por cima).
export const MONITOR_W = 1.6;
export const MONITOR_H = 0.9;
export const MONITOR_Y = 1.45;

const woodCache = new Map<string, THREE.CanvasTexture>();

/** Textura de madeira desenhada (veios suaves), uma por acabamento. */
function woodTexture(w: Wood): THREE.CanvasTexture {
  const hit = woodCache.get(w);
  if (hit) return hit;
  const info = WOODS.find((x) => x.id === w)!;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = info.base;
  g.fillRect(0, 0, 512, 256);
  // Veios: linhas onduladas com transparência variável.
  let seed = w.length * 97;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const plain = w === "grafite" || w === "preto" || w === "branco";
  for (let i = 0; i < (plain ? 26 : 60); i++) {
    const y = rnd() * 256;
    const amp = 2 + rnd() * 6;
    const freq = 0.004 + rnd() * 0.012;
    g.strokeStyle = info.grain;
    g.globalAlpha = (plain ? 0.18 : 0.35) * (0.4 + rnd());
    g.lineWidth = 0.6 + rnd() * (plain ? 1 : 2.2);
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const yy = y + Math.sin(x * freq + i) * amp;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  woodCache.set(w, tex);
  return tex;
}

let glowTex: THREE.CanvasTexture | null = null;
function softGlow(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.4, "rgba(255,255,255,0.35)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Monta a mesa. `accent` é a cor da pessoa (caneca) e `name` aparece no segundo monitor. */
export function buildDesk(style: DeskStyle, accent: THREE.ColorRepresentation, name: string): DeskModel {
  const g = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const big = style.size === "grande";
  const W = big ? 3.4 : 2.5;
  const D = big ? 1.25 : 1.15;
  const TOP_Y = 0.78;
  const zc = 0.25; // centro do tampo (igual ao escritório)

  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const metal = own(new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.32, metalness: 0.75 }));
  const plastic = own(new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.55, metalness: 0.15 }));

  // ---------- Tampo e pés ----------
  const woodTex = woodTexture(style.wood).clone();
  woodTex.needsUpdate = true;
  woodTex.repeat.set(W / 2.5, 1);
  woodTex.wrapS = THREE.RepeatWrapping;
  own(woodTex);
  const top = own(new THREE.MeshStandardMaterial({ map: woodTex, roughness: style.wood === "preto" ? 0.75 : 0.5, metalness: 0.05 }));
  add(new THREE.Mesh(own(new THREE.BoxGeometry(W, 0.05, D)), top), 0, TOP_Y, zc);
  // Borda de frente um pouco mais escura (dá acabamento).
  const edge = own(new THREE.MeshStandardMaterial({ color: new THREE.Color(WOODS.find((w) => w.id === style.wood)!.grain), roughness: 0.6 }));
  add(new THREE.Mesh(own(new THREE.BoxGeometry(W, 0.035, 0.012)), edge), 0, TOP_Y - 0.005, zc + D / 2 + 0.006);
  // Pés em "T" de metal com sapata.
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.12);
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.07, TOP_Y - 0.06, 0.07)), metal), x, (TOP_Y - 0.06) / 2 + 0.03, zc);
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.09, 0.03, D - 0.1)), metal), x, 0.015, zc);
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.05, 0.04, D - 0.25)), metal), x, TOP_Y - 0.045, zc);
  }
  add(new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.3, 0.05, 0.04)), metal), 0, TOP_Y - 0.05, zc - D / 2 + 0.12);

  // ---------- Monitores ----------
  const leds: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  const two = style.monitors === 2;
  const mainX = two ? (big ? -0.45 : -0.42) : 0;
  const monitor = (x: number, w: number, h: number, y: number, rotY: number, curved = false) => {
    const m = new THREE.Group();
    const frameGeo = new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.035, curved ? 48 : 1, 1, 1);
    const frame = new THREE.Mesh(own(curved ? bend(frameGeo) : frameGeo), plastic);
    frame.castShadow = true;
    m.add(frame);
    const backGeo = new THREE.BoxGeometry(w * 0.55, h * 0.5, 0.06, curved ? 24 : 1, 1, 1);
    backGeo.translate(0, 0, -0.04);
    const back = new THREE.Mesh(own(curved ? bend(backGeo) : backGeo), plastic);
    m.add(back);
    if (curved) {
      // Faixa de LED atrás do monitor curvo (aparece na parede).
      const strip = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
      const sg = new THREE.BoxGeometry(w * 0.5, 0.012, 0.012, 24, 1, 1);
      sg.translate(0, -h * 0.18, -0.075);
      m.add(new THREE.Mesh(own(bend(sg)), strip));
      if (style.leds !== "off") leds.push({ mat: strip, phase: 0.15 });
    }
    const neck = new THREE.Mesh(own(new THREE.BoxGeometry(0.06, y - TOP_Y - h / 2 + 0.05, 0.05)), metal);
    neck.position.set(0, -(y - TOP_Y) / 2 - h / 4 + 0.02, -0.07);
    m.add(neck);
    const base = new THREE.Mesh(own(new THREE.CylinderGeometry(0.17, 0.19, 0.022, 32)), metal);
    base.position.set(0, TOP_Y + 0.036 - y, -0.06);
    m.add(base);
    m.position.set(x, y, -0.1);
    m.rotation.y = rotY;
    g.add(m);
    return m;
  };
  monitor(mainX, MONITOR_W, MONITOR_H, MONITOR_Y, 0, style.curved);

  // Segundo monitor: relógio + nome num "papel de parede" com a cor do LED.
  let second: { tex: THREE.CanvasTexture; draw(): void } | null = null;
  if (two) {
    const sw = 1.0;
    const sh = 0.58;
    const sx = big ? 1.18 : 0.98;
    const mon = monitor(sx, sw, sh, 1.32, -0.42);
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 296;
    const ctx = c.getContext("2d")!;
    const tex = own(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const draw = () => {
      const grad = ctx.createLinearGradient(0, 0, 512, 296);
      grad.addColorStop(0, "#0b1020");
      grad.addColorStop(1, style.leds === "off" ? "#1e3a5f" : style.ledColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 296);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      for (let i = 0; i < 6; i++) ctx.fillRect(300, 40 + i * 36, 170, 18);
      const now = new Date();
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 92px system-ui, sans-serif";
      ctx.fillText(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, 30, 140);
      ctx.font = "600 28px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(name.slice(0, 18), 32, 190);
      ctx.font = "500 20px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText("Golfinho", 32, 250);
      tex.needsUpdate = true;
    };
    draw();
    const scr = new THREE.Mesh(own(new THREE.PlaneGeometry(sw, sh)), own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
    scr.position.z = 0.019;
    mon.add(scr);
    second = { tex, draw };
  }

  // ---------- Teclado, mouse, mousepad ----------
  const kbX = mainX - 0.05;
  let keys: THREE.InstancedMesh | null = null;
  const KEY_COLS = 15;
  const KEY_ROWS = 5;
  if (style.keyboard === "gamer") {
    // Mousepad grande com borda de LED.
    const padW = big ? 1.9 : 1.55;
    const padX = kbX + 0.25;
    add(new THREE.Mesh(own(new THREE.BoxGeometry(padW, 0.006, 0.42)), own(new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.95 }))), padX, TOP_Y + 0.028, 0.43);
    const padLed = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
    leds.push({ mat: padLed, phase: 0.3 });
    for (const [w, d, x, z] of [[padW, 0.008, padX, 0.43 + 0.21], [padW, 0.008, padX, 0.43 - 0.21], [0.008, 0.42, padX - padW / 2, 0.43], [0.008, 0.42, padX + padW / 2, 0.43]] as const) {
      add(new THREE.Mesh(own(new THREE.BoxGeometry(w, 0.008, d)), padLed), x, TOP_Y + 0.03, z);
    }
    // Teclado mecânico: base de alumínio escuro e teclas que acendem.
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.92, 0.035, 0.3)), metal), kbX, TOP_Y + 0.048, 0.42).rotation.x = 0.05;
    keys = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.05, 0.025, 0.048)), own(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })), KEY_COLS * KEY_ROWS);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (let r = 0; r < KEY_ROWS; r++) {
      for (let c = 0; c < KEY_COLS; c++) {
        m4.makeTranslation(kbX - 0.4 + c * 0.057, TOP_Y + 0.078 - r * 0.003, 0.32 + r * 0.052);
        keys.setMatrixAt(k++, m4);
      }
    }
    keys.castShadow = true;
    g.add(keys);
    // Luz por baixo das teclas (as cores vêm de update()).
    const under = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false, transparent: true, opacity: 0.9 }));
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.88, 0.004, 0.27)), under), kbX, TOP_Y + 0.067, 0.42);
    leds.push({ mat: under, phase: 0.6 });
    // Mouse com faixa de LED.
    const mouse = add(new THREE.Mesh(own(new THREE.SphereGeometry(0.05, 20, 12)), plastic), kbX + 0.68, TOP_Y + 0.045, 0.45);
    mouse.scale.set(0.75, 0.42, 1.25);
    const strip = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.008, 0.012, 0.09)), strip), kbX + 0.68, TOP_Y + 0.066, 0.45);
    leds.push({ mat: strip, phase: 0.9 });
  } else {
    // Teclado simples (claro) e mouse.
    const kb = own(new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.6 }));
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.9, 0.03, 0.28)), kb), kbX, TOP_Y + 0.045, 0.42);
    const keyMat = own(new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 }));
    add(new THREE.Mesh(own(new THREE.BoxGeometry(0.84, 0.012, 0.22)), keyMat), kbX, TOP_Y + 0.066, 0.42);
    const mouse = add(new THREE.Mesh(own(new THREE.SphereGeometry(0.05, 16, 10)), kb), kbX + 0.62, TOP_Y + 0.04, 0.44);
    mouse.scale.set(0.75, 0.4, 1.2);
  }

  // ---------- Caneca e enfeites ----------
  const left = -W / 2 + 0.3;
  const right = W / 2 - 0.3;
  const mugMat = own(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.45 }));
  add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.06, 0.055, 0.13, 20)), mugMat), left + 0.05, TOP_Y + 0.09, 0.5);
  const handle = add(new THREE.Mesh(own(new THREE.TorusGeometry(0.035, 0.01, 8, 16, Math.PI)), mugMat), left + 0.115, TOP_Y + 0.09, 0.5);
  handle.rotation.z = -Math.PI / 2;

  if (style.lamp) {
    // Canto da frente, à direita, virada para o teclado: longe dos monitores (que ficam atrás),
    // das caixas de som e do suporte de fone.
    const armMat = metal;
    const lamp = new THREE.Group();
    const part = (m: THREE.Mesh, x: number, y: number, z: number) => {
      m.position.set(x, y, z);
      m.castShadow = true;
      lamp.add(m);
      return m;
    };
    part(new THREE.Mesh(own(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 20)), armMat), 0, TOP_Y + 0.035, 0);
    part(new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8)), armMat), -0.06, TOP_Y + 0.24, 0).rotation.z = 0.3;
    part(new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8)), armMat), -0.25, TOP_Y + 0.47, 0).rotation.z = 1.25;
    part(new THREE.Mesh(own(new THREE.ConeGeometry(0.09, 0.13, 20, 1, true)),
      own(new THREE.MeshStandardMaterial({ color: 0x2dd4bf, emissive: 0x0b3b36, side: THREE.DoubleSide }))), -0.41, TOP_Y + 0.46, 0).rotation.z = 2.5;
    lamp.position.set(right + 0.12, 0, 0.15);
    lamp.rotation.y = 1.75; // cabeça sobre o canto da frente (não passa na frente das telas)
    g.add(lamp);
  }

  if (style.plant) {
    const px = left + (style.lamp ? 0.05 : 0.05);
    const pot = own(new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.8 }));
    add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.085, 0.065, 0.16, 20)), pot), px, TOP_Y + 0.105, 0.05);
    add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.08, 0.08, 0.01, 20)), own(new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }))), px, TOP_Y + 0.18, 0.05);
    const leaf = own(new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.7, side: THREE.DoubleSide }));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const l = add(new THREE.Mesh(own(new THREE.ConeGeometry(0.03, 0.26 + (i % 3) * 0.05, 6)), leaf), px + Math.cos(a) * 0.035, TOP_Y + 0.3, 0.05 + Math.sin(a) * 0.035);
      l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
  }

  if (style.headphones) {
    const hx = right - (style.lamp ? 0.05 : 0);
    const hz = 0.42;
    add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.06, 0.07, 0.015, 20)), metal), hx, TOP_Y + 0.033, hz);
    add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8)), metal), hx, TOP_Y + 0.18, hz);
    const band = add(new THREE.Mesh(own(new THREE.TorusGeometry(0.09, 0.014, 8, 24, Math.PI)), plastic), hx, TOP_Y + 0.33, hz);
    band.rotation.y = Math.PI / 2;
    const cupMat = own(new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.5 }));
    for (const s of [-1, 1]) {
      const cup = add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20)), cupMat), hx, TOP_Y + 0.25, hz + s * 0.09);
      cup.rotation.x = Math.PI / 2;
    }
    const ring = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
    for (const s of [-1, 1]) {
      const r = add(new THREE.Mesh(own(new THREE.TorusGeometry(0.045, 0.005, 6, 20)), ring), hx, TOP_Y + 0.25, hz + s * 0.112);
      r.rotation.x = 0;
    }
    if (style.leds !== "off") leds.push({ mat: ring, phase: 1.2 });
  }

  if (style.speakers) {
    const spMat = own(new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.5 }));
    const cone = own(new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.4 }));
    const xs = two ? [mainX - MONITOR_W / 2 - 0.16] : [-MONITOR_W / 2 - 0.16, MONITOR_W / 2 + 0.16];
    for (const x of xs) {
      add(new THREE.Mesh(own(new THREE.BoxGeometry(0.15, 0.26, 0.15)), spMat), x, TOP_Y + 0.155, -0.05);
      const w = add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 20)), cone), x, TOP_Y + 0.11, 0.028);
      w.rotation.x = Math.PI / 2;
      const t = add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 16)), cone), x, TOP_Y + 0.22, 0.028);
      t.rotation.x = Math.PI / 2;
    }
  }


  // ---------- Itens de apoiador: cadeira gamer, PC, neon, prateleira e controle ----------
  const anims: ((t: number) => void)[] = [];
  let chair: THREE.Group | undefined;
  if (style.chair === "gamer") {
    chair = new THREE.Group();
    const black = own(new THREE.MeshStandardMaterial({ color: 0x0f1115, roughness: 0.55 }));
    const stripe = own(new THREE.MeshStandardMaterial({ color: style.ledColor, roughness: 0.45, emissive: new THREE.Color(style.ledColor).multiplyScalar(0.25) }));
    const cpart = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(own(geo), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      chair!.add(m);
      return m;
    };
    // Assento com abas laterais.
    cpart(new THREE.BoxGeometry(0.52, 0.1, 0.52), black, 0, 0.5, 0);
    for (const sx of [-1, 1]) {
      cpart(new THREE.BoxGeometry(0.07, 0.12, 0.5), stripe, sx * 0.27, 0.55, 0).rotation.z = sx * -0.25;
    }
    // Encosto alto com abas, faixas na cor do LED, almofada lombar e de pescoço.
    const back = new THREE.Group();
    back.position.set(0, 0.56, 0.27);
    back.rotation.x = -0.12;
    chair.add(back);
    const bpart = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(own(geo), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      back.add(m);
      return m;
    };
    bpart(new THREE.BoxGeometry(0.5, 0.92, 0.09), black, 0, 0.46, 0);
    for (const sx of [-1, 1]) {
      bpart(new THREE.BoxGeometry(0.08, 0.7, 0.13), black, sx * 0.27, 0.37, -0.02).rotation.y = sx * 0.28;
      bpart(new THREE.BoxGeometry(0.035, 0.86, 0.095), stripe, sx * 0.17, 0.46, -0.005);
    }
    bpart(new THREE.BoxGeometry(0.42, 0.14, 0.1), black, 0, 0.98, 0.01);
    for (const sx of [-1, 1]) bpart(new THREE.BoxGeometry(0.1, 0.1, 0.1), black, sx * 0.2, 0.86, 0.01);
    const pillow = bpart(new THREE.CapsuleGeometry(0.06, 0.18, 6, 14), stripe, 0, 0.84, -0.07);
    pillow.rotation.z = Math.PI / 2;
    const lumbar = bpart(new THREE.CapsuleGeometry(0.06, 0.24, 6, 14), black, 0, 0.18, -0.07);
    lumbar.rotation.z = Math.PI / 2;
    // Logo nas costas do encosto.
    const lc = document.createElement("canvas");
    lc.width = lc.height = 128;
    const lg = lc.getContext("2d")!;
    lg.strokeStyle = "#ffffff";
    lg.lineCap = "round";
    lg.lineWidth = 12;
    lg.beginPath(); lg.moveTo(54, 24); lg.lineTo(54, 78); lg.quadraticCurveTo(54, 104, 30, 98); lg.stroke();
    lg.lineWidth = 8;
    for (const [rr, a] of [[22, 0.9], [36, 0.9]] as const) { lg.beginPath(); lg.arc(62, 54, rr, -a, a); lg.stroke(); }
    const ltex = own(new THREE.CanvasTexture(lc));
    ltex.colorSpace = THREE.SRGBColorSpace;
    const logoMat = own(new THREE.MeshBasicMaterial({ map: ltex, transparent: true, color: style.ledColor, toneMapped: false }));
    const logo = new THREE.Mesh(own(new THREE.PlaneGeometry(0.22, 0.22)), logoMat);
    logo.position.set(0, 0.62, 0.047);
    back.add(logo);
    if (style.leds !== "off") leds.push({ mat: logoMat, phase: 0.2 });
    // Braços, pistão e base de 5 pés com rodinhas.
    for (const sx of [-1, 1]) {
      cpart(new THREE.BoxGeometry(0.04, 0.2, 0.04), metal, sx * 0.31, 0.62, 0.02);
      cpart(new THREE.BoxGeometry(0.08, 0.035, 0.26), black, sx * 0.31, 0.73, -0.01);
    }
    cpart(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), metal, 0, 0.27, 0);
    cpart(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12), black, 0, 0.12, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = cpart(new THREE.BoxGeometry(0.055, 0.045, 0.34), metal, Math.sin(a) * 0.16, 0.07, Math.cos(a) * 0.16);
      leg.rotation.y = a;
      cpart(new THREE.SphereGeometry(0.03, 10, 8), black, Math.sin(a) * 0.32, 0.03, Math.cos(a) * 0.32);
    }
    chair.position.set(0, 0, 1.25);
    chair.userData.chair = true;
    g.add(chair);
  }

  if (style.pc !== "off") {
    const pc = buildPc(style.pc);
    // Embaixo da mesa, à direita, virado um pouco para quem senta: dá para ver o vidro e a frente.
    pc.position.set(W / 2 - (big ? 0.54 : 0.5), 0, zc - 0.06);
    pc.rotation.y = 0.55;
    g.add(pc);
  }

  /** Gabinete gamer detalhado. Eixos locais: x = profundidade (frente em -x), y = altura, z = largura (vidro em +z). */
  function buildPc(kind: "mini" | "medio" | "grande"): THREE.Group {
    const P = {
      mini: { d: 0.34, h: 0.32, w: 0.19, front: 1, fr: 0.062, gpuFans: 2, ram: 2, rear: false, aio: false, frontGlass: false },
      medio: { d: 0.44, h: 0.47, w: 0.215, front: 3, fr: 0.058, gpuFans: 3, ram: 4, rear: true, aio: false, frontGlass: false },
      grande: { d: 0.5, h: 0.56, w: 0.26, front: 3, fr: 0.066, gpuFans: 3, ram: 4, rear: true, aio: true, frontGlass: true },
    }[kind];
    const { d, h, w } = P;
    const t = 0.008; // espessura das chapas
    const root = new THREE.Group();
    const box = new THREE.Group();
    box.position.y = 0.025; // pezinhos
    root.add(box);
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = box) => {
      const m = new THREE.Mesh(own(geo), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    let ph = 0;
    const led = (opacity = 1) => {
      const m = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
      leds.push({ mat: m, phase: (ph += 0.37) });
      return m;
    };
    const shell = own(new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.4, metalness: 0.65 }));
    const dark = own(new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.7, metalness: 0.2 }));
    const pcb = own(new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: 0.55, metalness: 0.3 }));
    const alu = own(new THREE.MeshStandardMaterial({ color: 0x8a919c, roughness: 0.35, metalness: 0.85 }));
    const black = own(new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.5, metalness: 0.4 }));
    const sleeve = own(new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9 }));
    const glass = own(new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));

    // ----- Fan com anel de LED e pás translúcidas que giram -----
    const spinners: { g: THREE.Object3D; speed: number }[] = [];
    const fan = (r: number, parent: THREE.Object3D, speed = 7) => {
      const f = new THREE.Group();
      const fr = own(new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.6 }));
      for (const [bw, bh, x, y] of [[r * 2, r * 0.12, 0, r * 0.94], [r * 2, r * 0.12, 0, -r * 0.94], [r * 0.12, r * 2, r * 0.94, 0], [r * 0.12, r * 2, -r * 0.94, 0]] as const) {
        put(new THREE.BoxGeometry(bw, bh, 0.012), fr, x, y, 0, f);
      }
      put(new THREE.TorusGeometry(r * 0.84, r * 0.045, 8, 36), led(), 0, 0, 0.004, f);
      put(new THREE.TorusGeometry(r * 0.84, r * 0.045, 8, 36), led(), 0, 0, -0.004, f);
      const rotor = new THREE.Group();
      const bladeMat = led(0.32);
      for (let b = 0; b < 7; b++) {
        const a = (b / 7) * Math.PI * 2;
        const bl = put(new THREE.BoxGeometry(r * 0.5, r * 0.24, 0.003), bladeMat, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0, rotor);
        bl.rotation.set(0, 0.45, a);
      }
      const hub = put(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.014, 20), fr, 0, 0, 0, rotor);
      hub.rotation.x = Math.PI / 2;
      put(new THREE.CircleGeometry(r * 0.2, 20), led(), 0, 0, 0.0075, rotor);
      f.add(rotor);
      rotor.userData.dynamic = true;
      spinners.push({ g: rotor, speed });
      parent.add(f);
      return f;
    };

    // ----- Chapas do gabinete -----
    put(new THREE.BoxGeometry(d, t, w), shell, 0, h - t / 2, 0); // tampo
    put(new THREE.BoxGeometry(d, t, w), shell, 0, t / 2, 0); // fundo
    put(new THREE.BoxGeometry(d, h, t), shell, 0, h / 2, -w / 2 + t / 2); // lado de trás da placa-mãe
    put(new THREE.BoxGeometry(t, h, w), shell, d / 2 - t / 2, h / 2, 0); // traseira
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.014, 0.017, 0.025, 12), black, sx * (d / 2 - 0.04), -0.0125, sz * (w / 2 - 0.03));
    }
    // Vidro lateral com moldura preta.
    put(new THREE.PlaneGeometry(d - 0.012, h - 0.012), glass, 0, h / 2, w / 2 + 0.001);
    for (const [bw, bh, x, y] of [[d, 0.01, 0, h - 0.005], [d, 0.01, 0, 0.005], [0.01, h, -d / 2 + 0.005, h / 2], [0.01, h, d / 2 - 0.005, h / 2]] as const) {
      put(new THREE.BoxGeometry(bw, bh, 0.006), black, x, y, w / 2 + 0.002);
    }
    // Frente: vidro (vitrine) ou tela de malha que deixa o LED passar.
    if (P.frontGlass) {
      put(new THREE.PlaneGeometry(w - 0.012, h - 0.012), glass, -d / 2 - 0.001, h / 2, 0).rotation.y = -Math.PI / 2;
      // Fitas de LED nas quinas da frente e no topo.
      put(new THREE.BoxGeometry(0.006, h - 0.02, 0.006), led(), -d / 2 + 0.004, h / 2, w / 2 - 0.004);
      put(new THREE.BoxGeometry(0.006, h - 0.02, 0.006), led(), -d / 2 + 0.004, h / 2, -w / 2 + 0.004);
      put(new THREE.BoxGeometry(d - 0.02, 0.006, 0.006), led(), 0, h - 0.004, w / 2 - 0.004);
    } else {
      const mesh = own(new THREE.MeshStandardMaterial({ color: 0x0e1117, roughness: 0.85, metalness: 0.3, transparent: true, opacity: 0.72 }));
      put(new THREE.BoxGeometry(t, h, w), mesh, -d / 2 + t / 2, h / 2, 0);
      // Duas fitas de LED verticais na frente.
      for (const sz of [-1, 1]) put(new THREE.BoxGeometry(0.004, h * 0.8, 0.006), led(), -d / 2 - 0.002, h / 2, sz * (w / 2 - 0.018));
      // Botão de ligar com anel de LED.
      put(new THREE.TorusGeometry(0.008, 0.002, 6, 16), led(), -d / 2 - 0.003, h - 0.03, 0).rotation.y = Math.PI / 2;
    }

    // ----- Fans da frente (atrás do vidro/malha) -----
    const shroudH = h * 0.2;
    const fanX = -d / 2 + t + 0.016;
    const top = h - t - 0.012;
    for (let k = 0; k < P.front; k++) {
      const f = fan(P.fr, box, 6 + k);
      f.rotation.y = Math.PI / 2;
      f.position.set(fanX, top - P.fr - k * (P.fr * 2 + 0.006), 0);
    }

    // ----- Placa-mãe -----
    const mbW = d * 0.68, mbH = (h - shroudH) * 0.86;
    const mbX = d / 2 - t - mbW / 2 - 0.006, mbY = h - t - mbH / 2 - 0.01, mbZ = -w / 2 + t + 0.006;
    put(new THREE.BoxGeometry(mbW, mbH, 0.004), pcb, mbX, mbY, mbZ);
    // Detalhes: dissipadores das fases, chipset, M.2, slots e tampa do I/O com LED.
    const sx = mbX + mbW * 0.1, sy = mbY + mbH * 0.18; // soquete do processador
    put(new THREE.BoxGeometry(mbW * 0.45, 0.022, 0.018), alu, sx - mbW * 0.02, sy + 0.07, mbZ + 0.011);
    put(new THREE.BoxGeometry(0.022, mbH * 0.32, 0.018), alu, mbX + mbW / 2 - 0.02, sy + 0.01, mbZ + 0.011);
    const io = put(new THREE.BoxGeometry(0.03, mbH * 0.36, 0.022), black, mbX + mbW / 2 - 0.015, sy + 0.035, mbZ + 0.013);
    io.add(new THREE.Mesh(own(new THREE.BoxGeometry(0.004, mbH * 0.3, 0.002)), led()));
    io.children[0].position.set(-0.016, 0, 0.012);
    put(new THREE.BoxGeometry(mbW * 0.5, 0.012, 0.006), alu, mbX - mbW * 0.05, mbY - mbH * 0.08, mbZ + 0.006); // M.2
    put(new THREE.BoxGeometry(0.04, 0.04, 0.01), alu, mbX - mbW * 0.3, mbY - mbH * 0.3, mbZ + 0.007); // chipset
    for (let k = 0; k < 2; k++) put(new THREE.BoxGeometry(mbW * 0.8, 0.006, 0.007), black, mbX, mbY - mbH * 0.38 + k * 0.035, mbZ + 0.006);

    // ----- Memórias RAM com LED no topo -----
    const ramX = sx - 0.075;
    for (let k = 0; k < P.ram; k++) {
      const rx = ramX - k * 0.012;
      put(new THREE.BoxGeometry(0.008, 0.064, 0.03), dark, rx, sy + 0.005, mbZ + 0.017);
      put(new THREE.BoxGeometry(0.0085, 0.01, 0.03), led(), rx, sy + 0.042, mbZ + 0.017);
    }

    // ----- Refrigeração do processador -----
    if (P.aio) {
      // Water cooler: bomba com anel de LED e "tela", mangueiras até o radiador do topo.
      const pump = put(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 32), black, sx, sy, mbZ + 0.02);
      pump.rotation.x = Math.PI / 2;
      put(new THREE.TorusGeometry(0.031, 0.004, 8, 32), led(), sx, sy, mbZ + 0.036);
      put(new THREE.CircleGeometry(0.024, 32), led(0.85), sx, sy, mbZ + 0.0362);
      const radY = h - t - 0.02;
      put(new THREE.BoxGeometry(d * 0.74, 0.026, w * 0.62), alu, -0.01, radY, 0.01);
      for (let k = 0; k < 3; k++) {
        const f = fan(P.fr * 0.82, box, 8 + k);
        f.rotation.x = Math.PI / 2;
        f.position.set(-0.01 - d * 0.25 + k * d * 0.25, radY - 0.025, 0.01);
      }
      for (const off of [-0.012, 0.012]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(sx + 0.03, sy + off, mbZ + 0.03),
          new THREE.Vector3(sx + 0.07, sy + 0.06 + off, mbZ + 0.07),
          new THREE.Vector3(d * 0.28, radY - 0.04, 0.03 + off),
        ]);
        put(new THREE.TubeGeometry(curve, 24, 0.006, 8, false), sleeve, 0, 0, 0);
      }
    } else {
      // Cooler de torre: aletas de alumínio, heatpipes, fan na frente e tampa com LED.
      const ch = kind === "mini" ? 0.075 : 0.11;
      const cz = mbZ + 0.004 + 0.05;
      for (let k = 0; k < 10; k++) put(new THREE.BoxGeometry(0.0015, ch, 0.07), alu, sx - 0.022 + k * 0.005, sy + 0.005, cz);
      for (let k = 0; k < 3; k++) put(new THREE.CylinderGeometry(0.003, 0.003, ch + 0.02, 8), own(new THREE.MeshStandardMaterial({ color: 0xc58b52, roughness: 0.3, metalness: 0.9 })), sx - 0.012 + k * 0.012, sy, cz);
      put(new THREE.BoxGeometry(0.052, 0.006, 0.072), black, sx, sy + 0.005 + ch / 2 + 0.003, cz);
      put(new THREE.BoxGeometry(0.046, 0.002, 0.066), led(), sx, sy + 0.005 + ch / 2 + 0.007, cz);
      const cf = fan(ch * 0.48, box, 9);
      cf.rotation.y = Math.PI / 2;
      cf.position.set(sx - 0.032, sy + 0.005, cz);
    }

    // ----- Placa de vídeo -----
    const gLen = kind === "mini" ? mbW * 0.9 : Math.min(d - 0.07, mbW * 1.2);
    const gY = mbY - mbH * 0.38 + 0.03, gZ = mbZ + 0.055;
    const gX = d / 2 - t - gLen / 2 - 0.004;
    const shroud = own(new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.3, metalness: 0.7 }));
    put(new THREE.BoxGeometry(gLen, 0.048, 0.1), shroud, gX, gY, gZ);
    put(new THREE.BoxGeometry(gLen, 0.004, 0.1), alu, gX, gY + 0.026, gZ); // backplate
    put(new THREE.BoxGeometry(gLen * 0.72, 0.006, 0.003), led(), gX - gLen * 0.1, gY + 0.008, gZ + 0.051); // faixa de LED do lado
    put(new THREE.BoxGeometry(0.006, 0.08, 0.1), alu, d / 2 - t - 0.003, gY - 0.01, gZ); // suporte na traseira
    const gfr = Math.min(0.045, (gLen / P.gpuFans) * 0.42);
    for (let k = 0; k < P.gpuFans; k++) {
      const f = fan(gfr, box, 10 + k);
      f.rotation.x = Math.PI / 2;
      f.position.set(gX - gLen / 2 + (gLen / P.gpuFans) * (k + 0.5), gY - 0.026, gZ);
    }

    // ----- Fan traseiro -----
    if (P.rear) {
      const f = fan(Math.min(0.055, P.fr), box, 7);
      f.rotation.y = Math.PI / 2;
      f.position.set(d / 2 - t - 0.012, sy + 0.02, 0.01);
    }

    // ----- Capa da fonte (embaixo) com logo de LED -----
    put(new THREE.BoxGeometry(d - 0.05 - t, shroudH, w - 2 * t), dark, 0.025, t + shroudH / 2, 0);
    put(new THREE.BoxGeometry((d - 0.05) * 0.5, 0.006, 0.002), led(), 0.03, t + shroudH * 0.55, w / 2 - t + 0.0015);
    put(new THREE.BoxGeometry(d * 0.3, 0.012, 0.002), black, 0.12, t + shroudH * 0.3, w / 2 - t + 0.0015);

    // ----- Cabos trançados (24 pinos e o da placa de vídeo) -----
    const cables: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-d * 0.1, t + shroudH, -w * 0.1), new THREE.Vector3(-d * 0.16, mbY - mbH * 0.1, mbZ + 0.04), new THREE.Vector3(mbX - mbW / 2 + 0.01, mbY + mbH * 0.05, mbZ + 0.01)],
      [new THREE.Vector3(gX - gLen * 0.25, t + shroudH, 0), new THREE.Vector3(gX - gLen * 0.25, gY - 0.06, gZ + 0.02), new THREE.Vector3(gX - gLen * 0.2, gY - 0.02, gZ + 0.02)],
    ];
    for (const [a, b, c] of cables) put(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, b, c), 20, 0.008, 8, false), sleeve, 0, 0, 0);

    // ----- Brilho do LED por dentro (luz batendo na chapa) -----
    const glow = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
    leds.push({ mat: glow, phase: 0 });
    put(new THREE.PlaneGeometry(d - 0.03, h - 0.03), glow, 0, h / 2, mbZ + 0.003);
    // Luz de verdade dentro do gabinete (ilumina as peças com a cor do LED).
    const inner = new THREE.PointLight(style.ledColor, style.leds === "off" ? 0.25 : 0.9, Math.max(d, h) * 1.6, 1.6);
    inner.position.set(-d * 0.1, h * 0.55, w * 0.15);
    box.add(inner);
    const white = new THREE.PointLight(0xdfe8ff, 0.35, Math.max(d, h) * 1.4, 1.8);
    white.position.set(d * 0.15, h * 0.8, w * 0.3);
    box.add(white);
    anims.push(() => { inner.color.copy(glow.color); });

    anims.push((tt) => { for (const sp of spinners) sp.g.rotation.z = tt * sp.speed; });
    return root;
  }

  if (style.neon !== "off") {
    const text = style.neon === "nome" ? name.slice(0, 14) : style.neon === "gg" ? "GG" : style.neon === "onair" ? "ON AIR" : "Golfinho";
    const nc = document.createElement("canvas");
    nc.width = 1024;
    nc.height = 256;
    const nctx = nc.getContext("2d")!;
    const size = text.length > 8 ? 120 : 160;
    nctx.font = `800 ${size}px "Inter Variable", system-ui, sans-serif`;
    nctx.textAlign = "center";
    nctx.textBaseline = "middle";
    nctx.shadowColor = "#ffffff";
    nctx.shadowBlur = 26;
    nctx.lineWidth = 9;
    nctx.strokeStyle = "#ffffff";
    nctx.strokeText(text, 512, 132);
    nctx.shadowBlur = 0;
    nctx.lineWidth = 3;
    nctx.strokeStyle = "rgba(255,255,255,0.9)";
    nctx.strokeText(text, 512, 132);
    const ntex = own(new THREE.CanvasTexture(nc));
    ntex.colorSpace = THREE.SRGBColorSpace;
    const nmat = own(new THREE.MeshBasicMaterial({ map: ntex, transparent: true, color: style.ledColor, toneMapped: false, depthWrite: false }));
    const plate = new THREE.Mesh(own(new THREE.PlaneGeometry(1.6, 0.4)), nmat);
    const neonY = MONITOR_Y + MONITOR_H / 2 + (style.books || style.trophy || style.figure || style.cactus || style.aquarium ? 0.62 : 0.32);
    plate.position.set(two ? (mainX + (big ? 1.18 : 0.98)) / 2 : 0, neonY, -0.38);
    g.add(plate);
    // Placa de acrílico atrás do neon.
    const acr = new THREE.Mesh(own(new THREE.BoxGeometry(1.7, 0.46, 0.012)), own(new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 0.2, transparent: true, opacity: 0.55 })));
    acr.position.set(plate.position.x, neonY, -0.395);
    g.add(acr);
    leds.push({ mat: nmat, phase: 0.1 });
    anims.push((t) => { nmat.opacity = 0.92 + Math.sin(t * 2.2) * 0.05 + (Math.sin(t * 17.3) > 0.985 ? -0.45 : 0); });
  }

  const shelfItems = (["books", "trophy", "figure", "cactus", "aquarium"] as const).filter((k) => style[k]);
  if (shelfItems.length) {
    const SY = MONITOR_Y + MONITOR_H / 2 + 0.12;
    const SZ = -0.42;
    const SW = Math.min(W - 0.3, 2.6);
    const shelfMat = own(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 }));
    add(new THREE.Mesh(own(new THREE.BoxGeometry(SW, 0.035, 0.24)), shelfMat), 0, SY, SZ);
    for (const sx of [-1, 1]) {
      add(new THREE.Mesh(own(new THREE.BoxGeometry(0.03, SY - TOP_Y, 0.03)), metal), sx * (SW / 2 - 0.08), (SY + TOP_Y) / 2, SZ - 0.08);
    }
    const top = SY + 0.018;
    const slots = shelfItems.map((_, i) => -SW / 2 + 0.25 + (i + 0.5) * ((SW - 0.5) / shelfItems.length));
    shelfItems.forEach((item, i) => {
      const x = slots[i];
      if (item === "books") {
        const cols = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xa16207, 0x6d28d9];
        let bx = x - 0.14;
        cols.forEach((c, k) => {
          const h = 0.2 + (k % 3) * 0.03;
          const b = add(new THREE.Mesh(own(new THREE.BoxGeometry(0.045, h, 0.16)), own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }))), bx, top + h / 2, SZ);
          if (k === 4) { b.rotation.z = 0.32; b.position.x += 0.03; b.position.y -= 0.01; }
          bx += 0.05;
        });
        add(new THREE.Mesh(own(new THREE.BoxGeometry(0.16, 0.035, 0.12)), own(new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.8 }))), x + 0.17, top + 0.018, SZ);
      } else if (item === "trophy") {
        const gold = own(new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.25, metalness: 0.95 }));
        const prof = [[0.0, 0], [0.07, 0], [0.07, 0.025], [0.03, 0.04], [0.02, 0.1], [0.035, 0.12], [0.075, 0.2], [0.085, 0.27], [0.0, 0.27]].map(([a, b]) => new THREE.Vector2(a, b));
        add(new THREE.Mesh(own(new THREE.LatheGeometry(prof, 24)), gold), x, top, SZ);
        for (const sx of [-1, 1]) {
          const h = add(new THREE.Mesh(own(new THREE.TorusGeometry(0.035, 0.008, 8, 16, Math.PI)), gold), x + sx * 0.085, top + 0.22, SZ);
          h.rotation.z = sx * -Math.PI / 2;
        }
        add(new THREE.Mesh(own(new THREE.BoxGeometry(0.12, 0.05, 0.1)), own(new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 }))), x, top + 0.025, SZ);
      } else if (item === "figure") {
        // Mascote de mesa (robozinho do Golfinho) com cabeça de mola.
        const fig = new THREE.Group();
        const body = own(new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.35 }));
        const acc = own(new THREE.MeshStandardMaterial({ color: style.ledColor, roughness: 0.4 }));
        const torso = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.045, 0.05, 6, 14)), body);
        torso.position.y = 0.075;
        fig.add(torso);
        for (const sx of [-1, 1]) {
          const leg = new THREE.Mesh(own(new THREE.CylinderGeometry(0.014, 0.016, 0.04, 8)), acc);
          leg.position.set(sx * 0.022, 0.02, 0);
          fig.add(leg);
        }
        const head = new THREE.Group();
        head.userData.dynamic = true;
        head.position.y = 0.16;
        const skull = new THREE.Mesh(own(new THREE.SphereGeometry(0.07, 20, 14)), body);
        skull.scale.set(1.15, 0.95, 1);
        head.add(skull);
        const visor = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.025, 0.07, 4, 10)), own(new THREE.MeshStandardMaterial({ color: 0x0b0f16, roughness: 0.1 })));
        visor.rotation.z = Math.PI / 2;
        visor.position.set(0, 0.005, 0.058);
        head.add(visor);
        const eyeMat = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
        leds.push({ mat: eyeMat, phase: 0.7 });
        for (const sx of [-1, 1]) {
          const e = new THREE.Mesh(own(new THREE.SphereGeometry(0.011, 8, 6)), eyeMat);
          e.position.set(sx * 0.025, 0.006, 0.083);
          head.add(e);
        }
        const ant = new THREE.Mesh(own(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6)), metal);
        ant.position.y = 0.085;
        head.add(ant);
        const tip = new THREE.Mesh(own(new THREE.SphereGeometry(0.012, 8, 6)), eyeMat);
        tip.position.y = 0.112;
        head.add(tip);
        fig.add(head);
        fig.position.set(x, top, SZ);
        fig.rotation.y = 0.0;
        g.add(fig);
        anims.push((t) => { head.rotation.z = Math.sin(t * 3.1) * 0.12; head.rotation.x = Math.sin(t * 2.3 + 1) * 0.08; });
      } else if (item === "cactus") {
        const pot = own(new THREE.MeshStandardMaterial({ color: 0xc2410c, roughness: 0.8 }));
        add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.06, 0.045, 0.08, 16)), pot), x, top + 0.04, SZ);
        const green = own(new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 0.7 }));
        add(new THREE.Mesh(own(new THREE.CapsuleGeometry(0.032, 0.12, 6, 12)), green), x, top + 0.17, SZ);
        for (const sx of [-1, 1]) {
          const arm = add(new THREE.Mesh(own(new THREE.CapsuleGeometry(0.018, 0.05, 6, 10)), green), x + sx * 0.045, top + 0.19 + (sx > 0 ? 0.02 : 0), SZ);
          arm.rotation.z = sx * -0.2;
        }
        add(new THREE.Mesh(own(new THREE.SphereGeometry(0.012, 8, 6)), own(new THREE.MeshStandardMaterial({ color: 0xf472b6 }))), x, top + 0.26, SZ);
      } else if (item === "aquarium") {
        const aw = 0.34, ah = 0.2, ad = 0.16;
        const glassMat = own(new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false }));
        const tank = new THREE.Mesh(own(new THREE.BoxGeometry(aw, ah, ad)), glassMat);
        tank.position.set(x, top + ah / 2, SZ);
        g.add(tank);
        const water = new THREE.Mesh(own(new THREE.BoxGeometry(aw - 0.01, ah * 0.82, ad - 0.01)), own(new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.1, transparent: true, opacity: 0.32, emissive: 0x062a3d, depthWrite: false })));
        water.position.set(x, top + ah * 0.42, SZ);
        g.add(water);
        add(new THREE.Mesh(own(new THREE.BoxGeometry(aw - 0.012, 0.025, ad - 0.012)), own(new THREE.MeshStandardMaterial({ color: 0xd6c39a, roughness: 1 }))), x, top + 0.013, SZ);
        for (const k of [-1, 1]) add(new THREE.Mesh(own(new THREE.ConeGeometry(0.014, 0.09, 6)), own(new THREE.MeshStandardMaterial({ color: 0x22c55e }))), x + k * 0.1, top + 0.07, SZ - 0.03);
        const lid = own(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 }));
        add(new THREE.Mesh(own(new THREE.BoxGeometry(aw + 0.01, 0.012, ad + 0.01)), lid), x, top + ah + 0.006, SZ);
        const aqLight = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
        add(new THREE.Mesh(own(new THREE.BoxGeometry(aw - 0.04, 0.004, 0.02)), aqLight), x, top + ah - 0.002, SZ);
        leds.push({ mat: aqLight, phase: 0.9 });
        const fish: THREE.Mesh[] = [];
        for (const c of [0xf97316, 0xfacc15, 0xef4444]) {
          const f = new THREE.Mesh(own(new THREE.ConeGeometry(0.012, 0.035, 8)), own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: new THREE.Color(c).multiplyScalar(0.2) })));
          f.rotation.z = Math.PI / 2;
          g.add(f);
          f.userData.dynamic = true;
          fish.push(f);
        }
        anims.push((t) => {
          fish.forEach((f, k) => {
            const a = t * (0.6 + k * 0.17) + k * 2;
            const dir = Math.cos(a) >= 0 ? 1 : -1;
            f.position.set(x + Math.sin(a) * 0.12, top + 0.06 + k * 0.035 + Math.sin(t * 2 + k) * 0.01, SZ + Math.sin(a * 1.7 + k) * 0.04);
            f.rotation.set(0, 0, dir * Math.PI / 2);
          });
        });
      }
    });
  }

  if (style.controller) {
    // Controle de videogame na frente, à esquerda do teclado.
    const ctl = new THREE.Group();
    const shell = own(new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.45 }));
    const body = new THREE.Mesh(own(new THREE.BoxGeometry(0.16, 0.03, 0.08)), shell);
    ctl.add(body);
    for (const sx of [-1, 1]) {
      const grip = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.028, 0.05, 6, 12)), shell);
      grip.rotation.x = Math.PI / 2;
      grip.rotation.z = sx * 0.35;
      grip.position.set(sx * 0.075, -0.003, 0.03);
      ctl.add(grip);
      const stick = new THREE.Mesh(own(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12)), plastic);
      stick.position.set(sx * 0.035, 0.022, 0.012);
      ctl.add(stick);
    }
    for (const [bx, bz, c] of [[0.06, -0.012, 0x22c55e], [0.075, 0.0, 0xef4444], [0.045, 0.0, 0x3b82f6], [0.06, 0.012, 0xfacc15]] as const) {
      const b = new THREE.Mesh(own(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 10)), own(new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.4) })));
      b.position.set(bx, 0.018, bz - 0.015);
      ctl.add(b);
    }
    const bar = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
    const lb = new THREE.Mesh(own(new THREE.BoxGeometry(0.06, 0.004, 0.006)), bar);
    lb.position.set(0, 0.017, -0.035);
    ctl.add(lb);
    leds.push({ mat: bar, phase: 1.4 });
    ctl.traverse((o) => { o.castShadow = true; });
    ctl.position.set(left + 0.33, TOP_Y + 0.045, 0.28);
    ctl.rotation.y = 0.35;
    g.add(ctl);
  }

  // ---------- Fita de LED ----------
  let floorGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  let bias: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  if (style.leds !== "off") {
    const ledMat = own(new THREE.MeshBasicMaterial({ color: style.ledColor, toneMapped: false }));
    // Embaixo da borda de trás e das laterais do tampo.
    add(new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.08, 0.012, 0.012)), ledMat), 0, TOP_Y - 0.03, zc - D / 2 + 0.03);
    add(new THREE.Mesh(own(new THREE.BoxGeometry(W - 0.08, 0.012, 0.012)), ledMat), 0, TOP_Y - 0.03, zc + D / 2 - 0.03);
    leds.push({ mat: ledMat, phase: 0 });
    // Brilho no chão e atrás dos monitores.
    floorGlow = new THREE.Mesh(own(new THREE.PlaneGeometry(W * 1.6, D * 2.2)),
      own(new THREE.MeshBasicMaterial({ map: softGlow(), color: style.ledColor, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.set(0, 0.012, zc);
    g.add(floorGlow);
    bias = new THREE.Mesh(own(new THREE.PlaneGeometry((two ? W : MONITOR_W) * 1.4, 1.6)),
      own(new THREE.MeshBasicMaterial({ map: softGlow(), color: style.ledColor, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })));
    bias.position.set(two ? (mainX + (big ? 1.18 : 0.98)) / 2 : 0, MONITOR_Y, -0.22);
    g.add(bias);
  }

  // ---------- Animação ----------
  const base = new THREE.Color(style.ledColor);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  const tmp = new THREE.Color();
  let lastMinute = -1;
  const colorAt = (t: number, phase: number) => {
    if (style.leds === "rgb") return tmp.setHSL((t * 0.12 + phase * 0.15) % 1, 0.85, 0.55);
    if (style.leds === "pulsar") return tmp.setHSL(hsl.h, hsl.s, Math.max(0.12, hsl.l * (0.55 + 0.45 * Math.sin(t * 2.4 + phase))));
    return tmp.copy(base);
  };
  const update = (t: number) => {
    for (const l of leds) l.mat.color.copy(colorAt(t, l.phase));
    for (const a of anims) a(t);
    if (floorGlow) floorGlow.material.color.copy(colorAt(t, 0));
    if (bias) bias.material.color.copy(colorAt(t, 0.4));
    if (keys) {
      // Onda de cor correndo pelas teclas (ou a cor do LED, se desligado: branco suave).
      for (let r = 0; r < KEY_ROWS; r++) {
        for (let c = 0; c < KEY_COLS; c++) {
          const col = style.leds === "off" ? tmp.setHSL(0.5, 0.1, 0.55) : style.leds === "rgb"
            ? tmp.setHSL((t * 0.25 + c * 0.05 + r * 0.02) % 1, 0.9, 0.5)
            : colorAt(t, c * 0.15);
          keys.setColorAt(r * KEY_COLS + c, col);
        }
      }
      if (keys.instanceColor) keys.instanceColor.needsUpdate = true;
    }
    if (second) {
      const m = new Date().getMinutes();
      if (m !== lastMinute) { lastMinute = m; second.draw(); }
    }
  };
  update(0);

  return {
    group: g,
    mainX,
    width: W,
    curved: style.curved,
    chair,
    labelY: style.neon !== "off" ? MONITOR_Y + MONITOR_H / 2 + (shelfItems.length ? 0.62 : 0.32) + 0.42 : shelfItems.length ? MONITOR_Y + MONITOR_H / 2 + 0.62 : MONITOR_Y + 0.72,
    update,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
