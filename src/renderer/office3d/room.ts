// Sala no estilo do escritório do Golfinho Call (tema "escritório"): piso de madeira escura,
// janelas com a cidade à noite, sofá e planta. Texturas geradas em canvas, sem arquivos.
import * as THREE from "three";

/** Cores do tema escritório do Call. */
export const CALL_THEME = {
  bg: 0x07090d, fog: [0x07090d, 26, 60] as const, exposure: 1.25,
  hemi: [0xbfd8ff, 0x1a2030, 0.85] as const, key: [0xfff1dd, 1.6] as const, rim: [0x2dd4bf, 0.45] as const,
  wall: 0x141922, frame: 0x0b0e14, rugs: [0x16303a, 0x121a26] as const, sofa: [0x1f3a44, 0x24505c] as [number, number],
};

export function makeSofa(colors: [number, number] = [0x1f3a44, 0x24505c]): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colors[0], roughness: 0.9 });
  const cushion = new THREE.MeshStandardMaterial({ color: colors[1], roughness: 0.95 });
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  };
  part(3.2, 0.42, 1.2, 0, 0.21, 0, mat);
  part(3.2, 0.7, 0.28, 0, 0.62, 0.48, mat);
  part(0.26, 0.6, 1.2, -1.47, 0.5, 0, mat);
  part(0.26, 0.6, 1.2, 1.47, 0.5, 0, mat);
  part(1.32, 0.16, 0.9, -0.68, 0.5, -0.08, cushion);
  part(1.32, 0.16, 0.9, 0.68, 0.5, -0.08, cushion);
  return g;
}

export function makePlant(scale: number): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 20), new THREE.MeshStandardMaterial({ color: 0xd9d4c9, roughness: 0.7 }));
  pot.position.y = 0.275;
  pot.castShadow = pot.receiveShadow = true;
  g.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7d55, roughness: 0.8, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + (i % 3) * 0.05, 0), leafMat);
    const a = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.2, 0.8 + (i % 3) * 0.22, Math.sin(a) * 0.2);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  return g;
}

export function woodCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const plank = 64;
  for (let y = 0; y < 512; y += plank) {
    const offset = ((y / plank) % 2) * 160;
    for (let x = -offset; x < 512; x += 320) {
      const l = 18 + Math.random() * 6;
      ctx.fillStyle = `hsl(28 18% ${l}%)`;
      ctx.fillRect(x, y, 320, plank);
      // Veios
      ctx.strokeStyle = `hsla(28 20% ${l - 5}% / 0.5)`;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        const yy = y + 8 + Math.random() * (plank - 16);
        ctx.moveTo(x, yy);
        ctx.bezierCurveTo(x + 100, yy + 4, x + 200, yy - 4, x + 320, yy + 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(x, y, 2, plank);
    }
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, y, 512, 2);
  }
  return c;
}

export function cityCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#0b1a2e");
  sky.addColorStop(1, "#12324a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 256);
  for (let x = 0; x < 1024;) {
    const w = 40 + Math.random() * 90;
    const h = 70 + Math.random() * 150;
    ctx.fillStyle = `hsl(215 30% ${7 + Math.random() * 6}%)`;
    ctx.fillRect(x, 256 - h, w, h);
    for (let wy = 256 - h + 8; wy < 248; wy += 12) {
      for (let wx = x + 6; wx < x + w - 6; wx += 10) {
        if (Math.random() < 0.38) {
          ctx.fillStyle = Math.random() < 0.15 ? "#5eead4" : `hsl(40 90% ${55 + Math.random() * 25}%)`;
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
    x += w + 4;
  }
  return c;
}

