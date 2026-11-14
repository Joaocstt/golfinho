// Pets de apoiador: bichinhos originais do Golfinho Call que seguem o personagem pelo escritório.
// Feitos com formas simples (estilo fofinho, combina com o resto), animados por código.
// Os que andam ficam no chão; drone, golfinho e dragão voam na altura do ombro.
import * as THREE from "three";

/** Ver AVATAR_OPTIONS: no Escritório o pet também não projeta sombra no mapa. */
export const PET_OPTIONS = { castShadow: true };

export type PetId = "none" | "dog" | "cat" | "robot" | "dolphin" | "dragon";
export const PETS: { id: PetId; label: string; premium?: boolean; led?: boolean; emoji: string; desc: string }[] = [
  { id: "none", label: "Sem pet", emoji: "", desc: "" },
  { id: "dog", label: "Cachorrinho", premium: true, emoji: "🐶", desc: "Segue você abanando o rabo e senta do lado da cadeira." },
  { id: "cat", label: "Gatinho", premium: true, emoji: "🐱", desc: "Anda com o rabo para cima e mexe as orelhas." },
  { id: "robot", label: "Drone robô", premium: true, led: true, emoji: "🤖", desc: "Flutua do seu lado, com olhos de LED que piscam." },
  { id: "dolphin", label: "Golfinho voador", premium: true, emoji: "🐬", desc: "Nada no ar em volta de você, fazendo ondinhas." },
  { id: "dragon", label: "Dragãozinho", premium: true, led: true, emoji: "🐲", desc: "Bate as asas e voa por perto, com olhos que brilham." },
];
export const PET_COLORS = ["#d6a266", "#8b5a2b", "#f5f5f4", "#1f2937", "#9ca3af", "#f97316", "#60a5fa", "#a78bfa", "#34d399", "#f472b6"];

export interface Pet {
  group: THREE.Group;
  /** Voa (fica na altura do ombro) ou anda no chão. */
  flying: boolean;
  /** Materiais de LED (seguem a cor e o efeito do LED do personagem). */
  leds: THREE.MeshBasicMaterial[];
  /** dt em s, velocidade em m/s, sentado = o dono está sentado. */
  update(dt: number, speed: number, t: number): void;
  dispose(): void;
}

export function makePet(id: PetId, color: string, led: string): Pet | null {
  if (id === "none") return null;
  const g = new THREE.Group();
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => { own.push(x); return x; };
  const std = (c: THREE.ColorRepresentation, rough = 0.6, metal = 0) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }));
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = PET_OPTIONS.castShadow;
    parent.add(m);
    return m;
  };
  const pivot = (x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    parent.add(p);
    return p;
  };
  const leds: THREE.MeshBasicMaterial[] = [];
  const ledMat = () => { const m = keep(new THREE.MeshBasicMaterial({ color: led, toneMapped: false })); leds.push(m); return m; };
  const main = std(color, 0.7);
  const light = std(new THREE.Color(color).lerp(new THREE.Color("#fff7ed"), 0.55), 0.75);
  const dark = std(0x141414, 0.35);
  const white = std(0xffffff, 0.2);
  const eyes = (parent: THREE.Object3D, y: number, z: number, sep: number, r: number) => {
    for (const s of [-1, 1]) {
      part(new THREE.SphereGeometry(r, 12, 10), dark, s * sep, y, z, parent);
      part(new THREE.SphereGeometry(r * 0.35, 8, 6), white, s * sep + r * 0.3, y + r * 0.35, z - r * 0.75, parent);
    }
  };
  // Frente do pet = -Z (igual ao personagem no escritório).
  let walkPhase = 0;
  let update: Pet["update"];
  let flying = false;

  if (id === "dog" || id === "cat") {
    const cat = id === "cat";
    const body = part(new THREE.CapsuleGeometry(cat ? 0.085 : 0.1, cat ? 0.2 : 0.16, 8, 16), main, 0, 0.24, 0);
    body.rotation.x = Math.PI / 2;
    const belly = part(new THREE.CapsuleGeometry(cat ? 0.07 : 0.085, cat ? 0.16 : 0.12, 8, 14), light, 0, 0.215, -0.01);
    belly.rotation.x = Math.PI / 2;
    const head = pivot(0, 0.36, -0.17);
    part(new THREE.SphereGeometry(cat ? 0.1 : 0.11, 20, 16), main, 0, 0, 0, head);
    if (cat) {
      part(new THREE.SphereGeometry(0.05, 14, 10), light, 0, -0.03, -0.075, head).scale.set(1.25, 0.8, 0.8);
      part(new THREE.SphereGeometry(0.013, 8, 6), std(0xf472b6, 0.4), 0, -0.012, -0.112, head);
      const ears: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const ear = pivot(s * 0.06, 0.07, -0.005, head);
        part(new THREE.ConeGeometry(0.04, 0.08, 4), main, 0, 0.035, 0, ear).rotation.y = Math.PI / 4;
        part(new THREE.ConeGeometry(0.025, 0.05, 4), std(0xf9a8d4, 0.6), 0, 0.03, -0.012, ear).rotation.y = Math.PI / 4;
        ear.rotation.z = s * -0.25;
        ears.push(ear);
      }
      for (const s of [-1, 1]) for (const k of [-1, 1]) {
        const w = part(new THREE.CylinderGeometry(0.0015, 0.0015, 0.09, 4), white, s * 0.07, -0.025 + k * 0.008, -0.08, head);
        w.rotation.z = Math.PI / 2 + k * 0.15 * s;
      }
      eyes(head, 0.015, -0.08, 0.042, 0.018);
      // Rabo comprido para cima.
      const tail = pivot(0, 0.27, 0.15);
      const tailPts = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(0, Math.sin(i / 7 * 1.5) * 0.22, Math.sin(i / 7 * 0.9) * 0.08 + (i / 7) * 0.05));
      part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 20, 0.018, 8, false), main, 0, 0, 0, tail);
      (head.userData as { ears: THREE.Object3D[] }).ears = ears;
      head.userData.tail = tail;
    } else {
      part(new THREE.SphereGeometry(0.06, 14, 10), light, 0, -0.03, -0.085, head).scale.set(1, 0.8, 1.2);
      part(new THREE.SphereGeometry(0.02, 10, 8), dark, 0, -0.01, -0.15, head);
      part(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), std(0xf87171, 0.6), 0, -0.065, -0.12, head).rotation.x = 0.5;
      const ears: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const ear = pivot(s * 0.085, 0.05, 0.01, head);
        const e = part(new THREE.SphereGeometry(0.045, 12, 10), std(new THREE.Color(color).multiplyScalar(0.72), 0.7), 0, -0.04, 0, ear);
        e.scale.set(0.45, 1.25, 0.8);
        ear.rotation.z = s * 0.35;
        ears.push(ear);
      }
      eyes(head, 0.02, -0.09, 0.045, 0.018);
      // Coleira com plaquinha.
      const collar = part(new THREE.TorusGeometry(0.075, 0.012, 8, 20), std(0x2dd4bf, 0.4), 0, 0.3, -0.13);
      collar.rotation.x = Math.PI / 2 - 0.5;
      part(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 12), std(0xfacc15, 0.25, 0.9), 0, 0.25, -0.185).rotation.x = Math.PI / 2;
      const tail = pivot(0, 0.29, 0.15);
      part(new THREE.CapsuleGeometry(0.018, 0.1, 6, 10), main, 0, 0.06, 0.02, tail).rotation.x = -0.6;
      head.userData.ears = ears;
      head.userData.tail = tail;
    }
    const legs: THREE.Object3D[] = [];
    for (const [x, z] of [[-0.055, -0.1], [0.055, -0.1], [-0.055, 0.1], [0.055, 0.1]] as const) {
      const leg = pivot(x, 0.2, z);
      part(new THREE.CylinderGeometry(0.026, 0.024, 0.17, 10), main, 0, -0.09, 0, leg);
      part(new THREE.SphereGeometry(0.03, 10, 8), light, 0, -0.18, -0.008, leg).scale.set(1, 0.6, 1.2);
      legs.push(leg);
    }
    update = (dt, speed, t) => {
      const moving = Math.min(1, speed / 1.5);
      walkPhase += dt * (4 + speed * 5);
      legs.forEach((l, i) => { l.rotation.x = Math.sin(walkPhase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 * moving; });
      g.children[0].position.y = 0.24 + Math.abs(Math.sin(walkPhase)) * 0.012 * moving;
      const tail = head.userData.tail as THREE.Object3D;
      tail.rotation.y = Math.sin(t * (cat ? 2.2 : 9)) * (cat ? 0.25 : 0.55);
      tail.rotation.x = cat ? Math.sin(t * 1.3) * 0.1 : 0;
      head.rotation.x = Math.sin(t * 1.7) * 0.06 * (1 - moving);
      head.rotation.y = Math.sin(t * 0.6) * 0.3 * (1 - moving);
      (head.userData.ears as THREE.Object3D[]).forEach((e, i) => {
        const s = i === 0 ? -1 : 1;
        e.rotation.z = s * (cat ? -0.25 : 0.35) + Math.sin(t * (cat ? 0.8 : 6) + i) * (cat ? 0.06 : 0.12 * moving);
      });
    };
  } else if (id === "robot") {
    flying = true;
    const shell = std(color, 0.25, 0.3);
    const core = pivot(0, 0, 0);
    part(new THREE.SphereGeometry(0.15, 28, 20), shell, 0, 0, 0, core).scale.set(1, 0.92, 1);
    const visor = part(new THREE.SphereGeometry(0.135, 28, 20, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.3), std(0x0a0d14, 0.08, 0.3), 0, 0.01, 0, core);
    visor.rotation.x = -Math.PI / 2 + 0.25;
    visor.scale.setScalar(1.06);
    const eyeMat = ledMat();
    const eyesG: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const e = part(new THREE.CapsuleGeometry(0.018, 0.025, 4, 10), eyeMat, s * 0.045, 0.02, -0.142, core);
      eyesG.push(e);
    }
    const ring = part(new THREE.TorusGeometry(0.155, 0.012, 10, 36), std(0x1f2937, 0.3, 0.6), 0, -0.02, 0, core);
    ring.rotation.x = Math.PI / 2;
    const ant = pivot(0, 0.14, 0, core);
    part(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), std(0x1f2937, 0.3, 0.6), 0, 0.04, 0, ant);
    part(new THREE.SphereGeometry(0.02, 10, 8), ledMat(), 0, 0.09, 0, ant);
    const props: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const arm = part(new THREE.BoxGeometry(0.1, 0.015, 0.03), std(0x1f2937, 0.3, 0.6), s * 0.19, 0, 0, core);
      void arm;
      const p = pivot(s * 0.24, 0.02, 0, core);
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16), std(0x111827, 0.3, 0.5), 0, 0, 0, p);
      part(new THREE.BoxGeometry(0.09, 0.004, 0.014), std(0x9ca3af, 0.3, 0.7), 0, 0.009, 0, p);
      part(new THREE.TorusGeometry(0.047, 0.004, 6, 20), ledMat(), 0, -0.004, 0, p).rotation.x = Math.PI / 2;
      props.push(p);
    }
    let blink = 0;
    update = (dt, speed, t) => {
      core.position.y = Math.sin(t * 2.2) * 0.04;
      core.rotation.z = -Math.min(0.35, speed * 0.08) * Math.sin(t * 0.7) - 0.05;
      core.rotation.x = Math.min(0.3, speed * 0.1);
      props.forEach((p) => { p.rotation.y += dt * 40; });
      ant.rotation.z = Math.sin(t * 3) * 0.15;
      blink -= dt;
      if (blink < -3.2) blink = 0.12;
      eyesG.forEach((e) => { e.scale.y = blink > 0 ? 0.15 : 1; });
    };
  } else if (id === "dolphin") {
    flying = true;
    // Corpo torneado (lathe) deitado ao longo de Z, barriga clara.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const r = Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.8 * 0.085 * (1 - 0.55 * u) + 0.004;
      prof.push(new THREE.Vector2(r, u * 0.55));
    }
    const geo = new THREE.LatheGeometry(prof, 24);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.27);
    const col = new THREE.Color(color);
    const belly = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.7);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = pos.getY(i) < -0.01 ? belly : col;
      c.toArray(cols, i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    const skin = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 }));
    const swim = pivot(0, 0, 0);
    const bodyM = part(geo, skin, 0, 0, 0, swim);
    void bodyM;
    // Bico, olhos e sorriso.
    part(new THREE.CapsuleGeometry(0.022, 0.05, 6, 10), skin, 0, -0.01, -0.3, swim).rotation.x = Math.PI / 2;
    eyes(swim, 0.025, -0.2, 0.052, 0.013);
    // Barbatanas: dorsal, laterais e cauda (que mexe).
    const fin = (w: number, h: number) => {
      const s = new THREE.Shape();
      s.moveTo(-w / 2, 0);
      s.quadraticCurveTo(0, h * 0.2, w * 0.35, h);
      s.quadraticCurveTo(w * 0.15, h * 0.45, w / 2, 0);
      return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    };
    const dorsal = part(fin(0.1, 0.08), main, -0.006, 0.075, 0.0, swim);
    dorsal.rotation.y = Math.PI / 2;
    for (const s of [-1, 1]) {
      const p = part(fin(0.07, 0.07), main, s * 0.07, -0.04, -0.1, swim);
      p.rotation.set(0, s > 0 ? Math.PI / 2 : -Math.PI / 2, s * 1.9);
    }
    const tail = pivot(0, 0, 0.27, swim);
    for (const s of [-1, 1]) {
      const f = part(fin(0.08, 0.09), main, 0, 0, 0.02, tail);
      f.rotation.set(Math.PI / 2, 0, s * 1.2 + (s > 0 ? 0 : Math.PI));
    }
    update = (dt, speed, t) => {
      swim.position.y = Math.sin(t * 1.8) * 0.06;
      swim.rotation.x = Math.cos(t * 1.8) * 0.18;
      swim.rotation.z = Math.sin(t * 0.9) * 0.12;
      tail.rotation.x = Math.sin(t * (6 + speed * 2)) * 0.45;
      void dt;
    };
  } else {
    // Dragãozinho: corpo, cabeça com focinho, chifrinhos, asas que batem e rabo.
    flying = true;
    const fly = pivot(0, 0, 0);
    const body = part(new THREE.CapsuleGeometry(0.075, 0.12, 8, 16), main, 0, 0, 0.02, fly);
    body.rotation.x = Math.PI / 2 - 0.35;
    part(new THREE.CapsuleGeometry(0.06, 0.09, 8, 14), light, 0, -0.025, 0.0, fly).rotation.x = Math.PI / 2 - 0.35;
    const head = pivot(0, 0.09, -0.12, fly);
    part(new THREE.SphereGeometry(0.075, 18, 14), main, 0, 0, 0, head);
    part(new THREE.SphereGeometry(0.05, 14, 10), light, 0, -0.02, -0.06, head).scale.set(1.1, 0.75, 1.1);
    for (const s of [-1, 1]) {
      part(new THREE.SphereGeometry(0.007, 6, 5), dark, s * 0.02, -0.005, -0.112, head);
      const horn = part(new THREE.ConeGeometry(0.014, 0.06, 8), std(0xfef3c7, 0.5), s * 0.04, 0.07, 0.02, head);
      horn.rotation.x = -0.5;
      horn.rotation.z = s * -0.3;
    }
    const eyeMat = ledMat();
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.016, 10, 8), eyeMat, s * 0.038, 0.02, -0.058, head);
    // Espinhos nas costas.
    for (let k = 0; k < 4; k++) part(new THREE.ConeGeometry(0.012, 0.035, 6), std(0xfef3c7, 0.5), 0, 0.07 - k * 0.012, 0.0 + k * 0.045, fly).rotation.x = -0.4;
    const wingMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), roughness: 0.6, side: THREE.DoubleSide }));
    const wings: THREE.Object3D[] = [];
    for (const s of [-1, 1]) {
      const w = pivot(s * 0.05, 0.05, 0.02, fly);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(0.2, 0.08);
      sh.quadraticCurveTo(0.17, 0.02, 0.2, -0.04);
      sh.quadraticCurveTo(0.13, -0.03, 0.12, -0.08);
      sh.quadraticCurveTo(0.06, -0.05, 0, -0.06);
      const m = part(new THREE.ShapeGeometry(sh), wingMat, 0, 0, 0, w);
      m.rotation.x = -Math.PI / 2;
      m.scale.x = s;
      wings.push(w);
    }
    const tail = pivot(0, -0.03, 0.12, fly);
    const tpts = Array.from({ length: 7 }, (_, i) => new THREE.Vector3(0, -Math.sin(i / 6 * 1.2) * 0.06, i * 0.035));
    part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tpts), 16, 0.016, 8, false), main, 0, 0, 0, tail);
    part(new THREE.ConeGeometry(0.025, 0.04, 4), std(0xfef3c7, 0.5), 0, -0.065, 0.225, tail).rotation.x = Math.PI / 2;
    update = (dt, speed, t) => {
      const flap = Math.sin(t * (9 + speed * 3));
      wings.forEach((w, i) => { w.rotation.z = (i === 0 ? 1 : -1) * (0.2 + flap * 0.65); });
      fly.position.y = Math.sin(t * 2) * 0.05 - flap * 0.012;
      fly.rotation.x = Math.min(0.3, speed * 0.1);
      tail.rotation.y = Math.sin(t * 2.4) * 0.35;
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
      void dt;
    };
  }

  g.traverse((o) => { o.castShadow = PET_OPTIONS.castShadow; });
  return {
    group: g,
    flying,
    leds,
    update,
    dispose: () => { for (const d of own) d.dispose(); },
  };
}

/** LED do pet: cor fixa, RGB girando ou pulsando (igual ao LED dos acessórios). */
export function animatePetLeds(pet: Pet, base: THREE.Color, mode: string, t: number, tmp = new THREE.Color()) {
  if (!pet.leds.length) return;
  if (mode === "rgb") tmp.setHSL((t * 0.15) % 1, 0.9, 0.55);
  else if (mode === "pulsar") {
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    tmp.setHSL(hsl.h, hsl.s, Math.max(0.12, hsl.l * (0.55 + 0.45 * Math.sin(t * 2.6))));
  } else tmp.copy(base);
  for (const m of pet.leds) m.color.copy(tmp);
}

/**
 * Segue o dono: fica atrás e ao lado dele, anda junto (sem atropelar) e, quando ele para,
 * olha para a mesma direção. Sentado, o pet fica do lado da cadeira.
 */
export class PetFollower {
  pos = new THREE.Vector3();
  private led = new THREE.Color();
  private ledMode = "fixo";
  setLed(color: string, mode: string) { this.led.set(color); this.ledMode = mode; }
  private tmp = new THREE.Color();
  private ry = 0;
  private speed = 0;
  private ready = false;
  constructor(public pet: Pet) {}

  update(dt: number, t: number, owner: { x: number; z: number; ry: number; seated: boolean }) {
    // Ponto alvo no espaço do dono: à direita e um pouco atrás (sentado: do lado da cadeira).
    const fly = this.pet.flying;
    const ox = owner.seated ? (fly ? 0.85 : 0.72) : fly ? 0.9 : 0.62;
    const oz = owner.seated ? (fly ? 0.1 : 0.35) : fly ? 0.3 : 0.5;
    const c = Math.cos(owner.ry), s = Math.sin(owner.ry);
    const tx = owner.x + c * ox + s * oz;
    const tz = owner.z - s * ox + c * oz;
    if (!this.ready) { this.pos.set(tx, 0, tz); this.ry = owner.ry; this.ready = true; }
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    let want = 0;
    if (d > 0.12) want = Math.min(5, d * 3.2);
    this.speed += (want - this.speed) * (1 - Math.exp(-8 * dt));
    if (d > 4) { this.pos.set(tx, 0, tz); this.speed = 0; } // ficou muito para trás: aparece do lado
    else if (d > 1e-3) {
      const step = Math.min(d, this.speed * dt);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
    }
    const face = this.speed > 0.25 ? Math.atan2(-dx, -dz) : owner.ry;
    let diff = face - this.ry;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.ry += diff * (1 - Math.exp(-6 * dt));
    const g = this.pet.group;
    const fh = this.pet.flying ? (owner.seated ? 1.3 : 1.55) : 0;
    g.position.set(this.pos.x, fh, this.pos.z);
    g.rotation.y = this.ry;
    this.pet.update(dt, this.speed, t);
    animatePetLeds(this.pet, this.led, this.ledMode, t, this.tmp);
  }
}
