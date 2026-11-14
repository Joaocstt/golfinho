// Editor do personagem 3D: prévia girando + escolhas de corpo, pele, cabelo e roupa.
import * as THREE from "three";
import {
  BACKS, Character, CLOTH_COLORS, FACES, GLASSES, GLASSES_LED_COLORS, HAIR_COLORS, HAIRS, HANDS, HATS, hasLed, hasTint, type Look, NECKS, OUTFITS,
  SKIN_TONES, defaultLook,
} from "./avatar";

/** Marca de item de apoiador nas opções. */
// No Golfinho tudo vem liberado, inclusive os itens de apoiador do Call: sem a marca.
const GEM = "";
import { el } from "./dom";
import { animatePetLeds, makePet, type Pet, PET_COLORS, PETS } from "./pets";

export interface EditorHandle {
  element: HTMLElement;
  look: () => Look;
  dispose: () => void;
}

/** Monta o editor. `onChange` avisa a cada mudança (para habilitar o botão de salvar). */
/** lockBody: o corpo já foi decidido (no Golfinho, pelo "a/o" do agente): some a escolha de corpo. */
export function createEditor(initial: Look, onChange: () => void, opts: { lockBody?: boolean } = {}): EditorHandle {
  let look: Look = { ...initial };
  const wrap = el("div", "char-editor");

  // ---------- Prévia 3D ----------
  const stage = el("div", "char-stage");
  const canvas = el("canvas");
  stage.append(canvas);
  const hint = el("span", "char-hint muted small", "Arraste para girar");
  stage.append(hint);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.2, 3.9);
  camera.lookAt(0, 0.98, 0);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x1a2030, 1.4));
  const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
  key.position.set(1.5, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd8ff, 0.8);
  fill.position.set(-2, 1.5, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x2dd4bf, 1.4);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 48),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.12 }),
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  const character = new Character(look);
  // No escritório o personagem olha para -Z; aqui queremos de frente para a câmera.
  const turntable = new THREE.Group();
  turntable.add(character.root);
  turntable.rotation.y = Math.PI;
  scene.add(turntable);


  // Pet do lado do personagem (refaz quando muda o tipo ou a cor).
  let pet: Pet | null = null;
  let petKey = "";
  const petColor = new THREE.Color();
  const syncPet = () => {
    const key = look.pet === "none" ? "" : `${look.pet}:${look.petColor}`;
    if (key === petKey) return;
    petKey = key;
    if (pet) { turntable.remove(pet.group); pet.dispose(); }
    pet = makePet(look.pet, look.petColor, look.led);
    if (pet) {
      pet.group.position.set(0.62, pet.flying ? 1.4 : 0, 0.15);
      pet.group.rotation.y = -0.35;
      turntable.add(pet.group);
    }
  };
  syncPet();

  let yaw = Math.PI;
  let spin = 0.35;
  let dragging = false;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; spin = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (dragging) yaw += e.movementX * 0.01; });
  canvas.addEventListener("pointerup", () => { dragging = false; });

  let last = performance.now();
  let raf = 0;
  let wave = 0;
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    yaw += spin * dt;
    turntable.rotation.y = yaw;
    character.update(dt, 0, false);
    if (pet) { pet.update(dt, 0, now / 1000); animatePetLeds(pet, petColor.set(look.led), look.ledMode, now / 1000); }
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
  // Acena quando abre, para mostrar que está vivo.
  wave = window.setTimeout(() => character.playEmote("wave"), 600);

  // ---------- Controles ----------
  const controls = el("div", "char-controls");
  const update = (patch: Partial<Look>) => {
    look = { ...look, ...patch };
    character.setLook(look);
    syncPet();
    renderControls();
    onChange();
  };

  const group = (title: string, ...children: HTMLElement[]) => {
    const g = el("div", "char-group");
    g.append(el("span", "field-label", title), ...children);
    return g;
  };
  const segmented = <T extends string>(options: { v: T; label: string }[], value: T, on: (v: T) => void) => {
    const s = el("div", "segmented");
    for (const o of options) {
      const b = el("button", o.v === value ? "on" : "", o.label);
      b.type = "button";
      b.onclick = () => on(o.v);
      s.append(b);
    }
    return s;
  };
  const swatches = (colors: string[], value: string, on: (c: string) => void, round = false) => {
    const s = el("div", `swatches${round ? " round" : ""}`);
    for (const c of colors) {
      const b = el("button", `swatch${c.toLowerCase() === value.toLowerCase() ? " on" : ""}`);
      b.type = "button";
      b.style.background = c;
      b.title = c;
      b.onclick = () => on(c);
      s.append(b);
    }
    const custom = Object.assign(el("input"), { type: "color", value });
    custom.className = "swatch-custom";
    custom.title = "Outra cor";
    custom.onchange = () => on(custom.value);
    s.append(custom);
    return s;
  };

  function renderControls() {
    const hairOptions = HAIRS.map((h) => ({ v: h.id, label: h.label + (h.premium ? GEM : "") }));
    controls.replaceChildren(
      ...(opts.lockBody ? [] : [group("Corpo", segmented([{ v: "male", label: "Masculino" }, { v: "female", label: "Feminino" }], look.body, (v) => update({ body: v })))]),
      group("Tom de pele", swatches(SKIN_TONES, look.skin, (c) => update({ skin: c }), true)),
      group("Cabelo", segmented(hairOptions, look.hair, (v) => update({ hair: v }))),
      group("Cor do cabelo", swatches(HAIR_COLORS, look.hairColor, (c) => update({ hairColor: c }), true)),
      ...(opts.lockBody && look.body === "female"
        ? []
        : [group("Barba", segmented([{ v: "no", label: "Sem barba" }, { v: "yes", label: "Com barba" }], look.beard ? "yes" : "no", (v) => update({ beard: v === "yes" })))]),
      group("Camisa", swatches(CLOTH_COLORS, look.shirt, (c) => update({ shirt: c }))),
      group("Mangas", segmented([{ v: "short", label: "Curtas" }, { v: "long", label: "Compridas" }], look.sleeves, (v) => update({ sleeves: v }))),
      group("Calça", swatches(CLOTH_COLORS, look.pants, (c) => update({ pants: c }))),
      group("Sapatos", swatches(CLOTH_COLORS, look.shoes, (c) => update({ shoes: c }))),
      group("Por cima", segmented(OUTFITS.map((o) => ({ v: o.id, label: o.label + (o.premium ? GEM : "") })), look.outfit, (v) => update({ outfit: v }))),
      ...(look.outfit !== "none" ? [group("Cor da roupa", swatches(CLOTH_COLORS, look.outfitColor, (c) => update({ outfitColor: c })))] : []),
      group("Óculos", segmented(GLASSES.map((g) => ({ v: g.id, label: g.label + (g.premium ? GEM : "") })), look.glasses, (v) => update({ glasses: v }))),
      group("Na cabeça", segmented(HATS.map((h) => ({ v: h.id, label: h.label + (h.premium ? GEM : "") })), look.hat, (v) => update({ hat: v }))),
      group("Rosto", segmented(FACES.map((i) => ({ v: i.id, label: i.label + (i.premium ? GEM : "") })), look.face, (v) => update({ face: v }))),
      group("Pescoço", segmented(NECKS.map((i) => ({ v: i.id, label: i.label + (i.premium ? GEM : "") })), look.neck, (v) => update({ neck: v }))),
      group("Costas", segmented(BACKS.map((i) => ({ v: i.id, label: i.label + (i.premium ? GEM : "") })), look.back, (v) => update({ back: v }))),
      group("Mãos e pulsos", segmented(HANDS.map((i) => ({ v: i.id, label: i.label + (i.premium ? GEM : "") })), look.hands, (v) => update({ hands: v }))),
      group("Pet", segmented(PETS.map((p) => ({ v: p.id, label: p.label + (p.premium ? GEM : "") })), look.pet, (v) => update({ pet: v }))),
      ...(look.pet !== "none" && look.pet !== "robot" ? [group("Cor do pet", swatches(PET_COLORS, look.petColor, (c) => update({ petColor: c })))] : []),
      ...(look.pet === "robot" ? [group("Cor do drone", swatches(PET_COLORS, look.petColor, (c) => update({ petColor: c })))] : []),
      ...(hasTint(look) ? [group("Cor dos acessórios", swatches(CLOTH_COLORS, look.hatColor, (c) => update({ hatColor: c })))] : []),
      ...(hasLed(look) ? [
        group("LED", segmented([{ v: "fixo", label: "Cor fixa" }, { v: "rgb", label: "RGB" }, { v: "pulsar", label: "Pulsar" }], look.ledMode, (v) => update({ ledMode: v }))),
        group("Cor do LED", swatches(GLASSES_LED_COLORS, look.led, (c) => update({ led: c }), true)),
      ] : []),
    );
  }
  renderControls();

  const random = el("button", "ghost", "Sortear visual");
  random.type = "button";
  // Sorteia o resto, mas mantém os acessórios escolhidos.
  random.onclick = () => update(sorted());
  // Sorteia o resto; com o corpo travado, sorteia até sair um visual com o mesmo corpo.
  const sorted = (): Look => {
    let fresh = defaultLook(Math.floor(Math.random() * 1e9));
    for (let i = 0; opts.lockBody && fresh.body !== look.body && i < 40; i++) fresh = defaultLook(Math.floor(Math.random() * 1e9));
    return { ...fresh, ...(opts.lockBody ? { body: look.body, beard: look.body === "male" && fresh.beard } : {}),
    glasses: look.glasses, hat: look.hat, hatColor: look.hatColor, led: look.led, ledMode: look.ledMode,
    outfit: look.outfit, outfitColor: look.outfitColor,
    face: look.face, neck: look.neck, back: look.back, hands: look.hands,
    pet: look.pet, petColor: look.petColor,
    };
  };
  const dance = el("button", "ghost", "Dançar");
  dance.type = "button";
  dance.onclick = () => character.playEmote("dance");
  const tools = el("div", "row");
  tools.append(random, dance);
  stage.append(tools);

  wrap.append(stage, controls);
  return {
    element: wrap,
    look: () => look,
    dispose: () => {
      cancelAnimationFrame(raf);
      clearTimeout(wave);
      pet?.dispose();
      character.dispose();
      renderer.dispose();
    },
  };
}
