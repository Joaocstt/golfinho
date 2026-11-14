// Editor da mesa: prévia 3D girando + escolhas (tamanho, madeira, monitores, LEDs, teclado, enfeites).
import * as THREE from "three";
import { buildDesk, type DeskModel, type DeskStyle, LED_COLORS, NEON_TEXTS, WOODS, screenGeometry } from "./desk3d";
import { el } from "./dom";
import { makeChair } from "./chair";

export interface DeskEditorHandle {
  element: HTMLElement;
  style: () => DeskStyle;
  dispose: () => void;
}

export function createDeskEditor(initial: DeskStyle, accent: THREE.ColorRepresentation, name: string, onChange: () => void): DeskEditorHandle {
  let style: DeskStyle = { ...initial };
  const wrap = el("div", "char-editor desk-editor");
  const stage = el("div", "char-stage desk-stage");
  const canvas = el("canvas");
  stage.append(canvas, el("span", "char-hint muted small", "Arraste para girar"));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x141a26, 0.9));
  const key = new THREE.DirectionalLight(0xfff1dd, 1.8);
  key.position.set(2.5, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6aa8ff, 0.7);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.6, 64), new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const chair = makeChair(accent);
  chair.position.set(0, 0, 1.25);
  scene.add(chair);
  // Tela de exemplo no monitor principal.
  const demo = document.createElement("canvas");
  demo.width = 512;
  demo.height = 288;
  const dc = demo.getContext("2d")!;
  const grad = dc.createLinearGradient(0, 0, 512, 288);
  grad.addColorStop(0, "#0f766e");
  grad.addColorStop(1, "#1d4ed8");
  dc.fillStyle = grad;
  dc.fillRect(0, 0, 512, 288);
  dc.fillStyle = "rgba(255,255,255,0.9)";
  dc.font = "700 34px system-ui, sans-serif";
  dc.fillText(`Tela de ${name}`.slice(0, 22), 28, 60);
  dc.fillStyle = "rgba(255,255,255,0.3)";
  for (let i = 0; i < 5; i++) dc.fillRect(28, 100 + i * 32, 260 + ((i * 83) % 160), 14);
  const demoTex = new THREE.CanvasTexture(demo);
  demoTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: demoTex, toneMapped: false }));
  scene.add(screen);

  let model: DeskModel | null = null;
  const rebuild = () => {
    if (model) { scene.remove(model.group); model.dispose(); }
    model = buildDesk(style, accent, name);
    scene.add(model.group);
    chair.visible = !model.chair; // cadeira gamer vem com a mesa
    screen.geometry.dispose();
    screen.geometry = screenGeometry(model.curved);
    screen.position.set(model.mainX, 1.45, -0.07);
  };
  rebuild();

  let yaw = 0.55;
  let spin = 0.18;
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; spin = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (dragging) yaw -= e.movementX * 0.008; });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  // Roda do mouse aproxima (para ver os detalhes do PC, do teclado...).
  let zoom = 1;
  let zoomWant = 1;
  /** Ponto para onde a câmera olha (volta para o centro da mesa quando o zoom some). */
  let focusPc = false;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomWant = Math.min(1.25, Math.max(0.3, zoomWant * (e.deltaY > 0 ? 1.12 : 0.89)));
    if (zoomWant > 0.85) focusPc = false;
  }, { passive: false });

  let last = performance.now();
  let raf = 0;
  let clock = 0;
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    clock += dt;
    yaw += spin * dt * Math.sin(clock * 0.4); // vai e volta devagar
    const tall = style.neon !== "off" || style.books || style.trophy || style.figure || style.cactus || style.aquarium;
    // Mais longe em telas estreitas e na mesa grande (cabe a mesa inteira).
    const narrow = camera.aspect < 1.2 ? 1.25 : 1;
    zoom += (zoomWant - zoom) * Math.min(1, dt * 6);
    const dist = (style.size === "grande" ? 5.6 : 4.8) * narrow * zoom;
    // Com zoom no PC, olha para o gabinete (embaixo da mesa, à direita).
    const pcX = (style.size === "grande" ? 1.7 - 0.54 : 1.25 - 0.5);
    const k = focusPc ? Math.min(1, (1 - zoom) / 0.6) : 0;
    const tx = pcX * k, ty = (tall ? 1.15 : 0.9) * (1 - k) + 0.28 * k, tz = 0.1 + 0.1 * k;
    camera.position.set(tx + Math.sin(yaw) * dist, ty + (tall ? 1.85 : 1.8) * Math.max(0.35, zoom), tz + 0.15 + Math.cos(yaw) * dist);
    camera.lookAt(tx, ty, tz);
    model?.update(clock);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // ---------- Controles ----------
  const controls = el("div", "char-controls");
  const update = (patch: Partial<DeskStyle>) => {
    style = { ...style, ...patch };
    // Escolheu um PC: a câmera chega perto dele para mostrar os detalhes.
    if (patch.pc && patch.pc !== "off") { focusPc = true; zoomWant = 0.42; yaw = 0.35; spin = 0; }
    else if (patch.pc === "off") { focusPc = false; zoomWant = 1; }
    rebuild();
    renderControls();
    onChange();
  };
  const group = (title: string, ...children: HTMLElement[]) => {
    const g = el("div", "char-group");
    g.append(el("span", "field-label", title), ...children);
    return g;
  };
  const segmented = <T extends string | number>(options: { v: T; label: string }[], value: T, on: (v: T) => void) => {
    const s = el("div", "segmented");
    for (const o of options) {
      const b = el("button", o.v === value ? "on" : "", o.label);
      b.type = "button";
      b.onclick = () => on(o.v);
      s.append(b);
    }
    return s;
  };
  const toggle = (label: string, on: boolean, set: (v: boolean) => void) => {
    const b = el("button", on ? "on" : "", label);
    b.type = "button";
    b.onclick = () => set(!on);
    return b;
  };

  function renderControls() {
    const woods = el("div", "swatches");
    for (const w of WOODS) {
      const b = el("button", `swatch wood${w.id === style.wood ? " on" : ""}`);
      b.type = "button";
      b.style.background = `linear-gradient(135deg, ${w.base}, ${w.grain})`;
      b.title = w.label;
      b.onclick = () => update({ wood: w.id });
      woods.append(b);
    }
    const ledColors = el("div", "swatches round");
    for (const c of LED_COLORS) {
      const b = el("button", `swatch${c === style.ledColor ? " on" : ""}`);
      b.type = "button";
      b.style.background = c;
      b.style.boxShadow = `0 0 10px ${c}88`;
      b.onclick = () => update({ ledColor: c, leds: style.leds === "off" ? "fixo" : style.leds });
      ledColors.append(b);
    }
    const custom = Object.assign(el("input"), { type: "color", value: style.ledColor });
    custom.className = "swatch-custom";
    custom.title = "Outra cor";
    custom.onchange = () => update({ ledColor: custom.value, leds: style.leds === "off" ? "fixo" : style.leds });
    ledColors.append(custom);
    const extras = el("div", "segmented wrap");
    extras.append(
      toggle("Luminária 💎", style.lamp, (v) => update({ lamp: v })),
      toggle("Planta 💎", style.plant, (v) => update({ plant: v })),
      toggle("Fone no suporte 💎", style.headphones, (v) => update({ headphones: v })),
      toggle("Caixas de som 💎", style.speakers, (v) => update({ speakers: v })),
      toggle("Controle 💎", style.controller, (v) => update({ controller: v })),
    );
    const shelf = el("div", "segmented wrap");
    shelf.append(
      toggle("Livros 💎", style.books, (v) => update({ books: v })),
      toggle("Troféu 💎", style.trophy, (v) => update({ trophy: v })),
      toggle("Mascote 💎", style.figure, (v) => update({ figure: v })),
      toggle("Cacto 💎", style.cactus, (v) => update({ cactus: v })),
      toggle("Aquário 💎", style.aquarium, (v) => update({ aquarium: v })),
    );
    controls.replaceChildren(
      group("Tamanho 💎", segmented([{ v: "normal", label: "Normal" }, { v: "grande", label: "Grande (3,4 m) 💎" }], style.size, (v) => update({ size: v }))),
      group("Acabamento 💎", woods),
      group("Monitores 💎", segmented([{ v: 1, label: "Um monitor" }, { v: 2, label: "Dois monitores 💎" }], style.monitors, (v) => update({ monitors: v }))),
      group("Tela principal 💎", segmented([{ v: "reta", label: "Reta" }, { v: "curva", label: "Curva 💎" }], style.curved ? "curva" : "reta", (v) => update({ curved: v === "curva" }))),
      group("Teclado 💎", segmented([{ v: "padrao", label: "Simples" }, { v: "gamer", label: "Gamer RGB 💎" }], style.keyboard, (v) => update({ keyboard: v }))),
      group("LEDs 💎", segmented([{ v: "off", label: "Desligado" }, { v: "fixo", label: "Cor fixa 💎" }, { v: "rgb", label: "RGB 💎" }, { v: "pulsar", label: "Pulsar 💎" }], style.leds, (v) => update({ leds: v }))),
      group("Cor do LED 💎", ledColors),
      group("Cadeira 💎", segmented([{ v: "padrao", label: "Escritório" }, { v: "gamer", label: "Gamer 💎" }], style.chair, (v) => update({ chair: v }))),
      group("PC gamer 💎", segmented([{ v: "off", label: "Sem PC" }, { v: "mini", label: "Pequeno 💎" }, { v: "medio", label: "Médio 💎" }, { v: "grande", label: "Grande 💎" }] as const, style.pc, (v) => update({ pc: v }))),
      group("Enfeites 💎", extras),
      group("Prateleira 💎", shelf),
      group("Neon 💎", segmented(NEON_TEXTS.map((n) => ({ v: n.id, label: n.id === "off" ? n.label : `${n.label} 💎` })), style.neon, (v) => update({ neon: v }))),
    );
  }
  renderControls();

  wrap.append(stage, controls);
  return {
    element: wrap,
    style: () => style,
    dispose: () => {
      cancelAnimationFrame(raf);
      model?.dispose();
      demoTex.dispose();
      renderer.dispose();
    },
  };
}
