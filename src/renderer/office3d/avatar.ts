// Personagens 3D (Quaternius Universal Base Characters + Universal Animation Library).
// Carrega os modelos uma vez, prende cabelo/barba no esqueleto do corpo, toca as animações
// e "pinta" a roupa no corpo com um shader por região (camisa, mangas, calça, sapato).
import * as THREE from "three";
import { PETS, type PetId } from "./pets";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export type Body = "male" | "female";
export type Sleeves = "short" | "long";

export interface Look {
  body: Body;
  skin: string;
  hair: string;
  hairColor: string;
  beard: boolean;
  shirt: string;
  sleeves: Sleeves;
  pants: string;
  shoes: string;
  /** Acessórios: óculos, o que vai na cabeça (boné, gorro, headset) e o LED (cor e efeito). */
  glasses: Glasses;
  hat: Hat;
  hatColor: string;
  /** Rosto (máscara), pescoço, costas e mãos (itens de apoiador). */
  face: Face;
  neck: Neck;
  back: Back;
  hands: Hands;
  /** Pet que segue o personagem (apoiador) e a cor dele. */
  pet: PetId;
  petColor: string;
  /** Roupa por cima (jaqueta com a logo) e a cor dela. */
  outfit: Outfit;
  outfitColor: string;
  led: string;
  ledMode: GlassesLed;
}

export type Outfit = "none" | "jacket" | "hoodie" | "tee" | "vest" | "college";
export const OUTFITS: { id: Outfit; label: string; premium?: boolean }[] = [
  { id: "none", label: "Só a camisa" },
  { id: "jacket", label: "Jaqueta Golfinho", premium: true },
  { id: "hoodie", label: "Moletom", premium: true },
  { id: "tee", label: "Camiseta", premium: true },
  { id: "vest", label: "Colete puffer", premium: true },
  { id: "college", label: "Jaqueta college", premium: true },
];
export type Glasses = "none" | "gamer" | "round" | "aviator" | "vr";
export type Hat = "none" | "cap_front" | "cap_back" | "beanie" | "headset" | "bandana" | "bucket" | "cat_ears" | "halo" | "horns";
export type Face = "none" | "mask_led";
export type Neck = "none" | "dj" | "chain" | "scarf";
export type Back = "none" | "backpack" | "wings";
export type Hands = "none" | "watch" | "bracelet" | "gloves";
/** `led`: tem LED; `tint`: usa a cor dos acessórios. */
export type Item<T> = { id: T; label: string; premium?: boolean; led?: boolean; tint?: boolean };
export const FACES: Item<Face>[] = [
  { id: "none", label: "Nada" },
  { id: "mask_led", label: "Máscara de LED", premium: true, led: true },
];
export const NECKS: Item<Neck>[] = [
  { id: "none", label: "Nada" },
  { id: "dj", label: "Fone DJ", premium: true, tint: true },
  { id: "chain", label: "Corrente com pingente", premium: true },
  { id: "scarf", label: "Cachecol", premium: true, tint: true },
];
export const BACKS: Item<Back>[] = [
  { id: "none", label: "Nada" },
  { id: "backpack", label: "Mochila gamer", premium: true, led: true, tint: true },
  { id: "wings", label: "Asas de LED", premium: true, led: true },
];
export const HANDS: Item<Hands>[] = [
  { id: "none", label: "Nada" },
  { id: "watch", label: "Relógio smart", premium: true, led: true },
  { id: "bracelet", label: "Pulseira de LED", premium: true, led: true },
  { id: "gloves", label: "Luvas sem dedo", premium: true, tint: true },
];
/** Quanto a roupa de cima engrossa o corpo (as peças do corpo sobem por cima dela). */
const OUTFIT_THICK: Record<string, number> = { jacket: 1, hoodie: 1.15, tee: 0.5, vest: 1.6, college: 1 };
export type GlassesLed = "fixo" | "rgb" | "pulsar";
export const GLASSES: { id: Glasses; label: string; premium?: boolean }[] = [
  { id: "none", label: "Sem óculos" },
  { id: "gamer", label: "Gamer com LED", premium: true },
  { id: "round", label: "Redondo", premium: true },
  { id: "aviator", label: "Aviador", premium: true },
  { id: "vr", label: "Óculos VR", premium: true },
];
/** `covers`: esconde o cabelo (boné e gorro cobrem tudo); `led`: tem LED; `tint`: usa a cor escolhida. */
export const HATS: { id: Hat; label: string; premium?: boolean; covers?: boolean; led?: boolean; tint?: boolean }[] = [
  { id: "none", label: "Nada" },
  { id: "cap_front", label: "Boné", premium: true, covers: true, tint: true },
  { id: "cap_back", label: "Boné para trás", premium: true, covers: true, tint: true },
  { id: "beanie", label: "Gorro", premium: true, covers: true, tint: true },
  { id: "headset", label: "Headset gamer", premium: true, led: true },
  { id: "bandana", label: "Bandana", premium: true, covers: true, tint: true },
  { id: "bucket", label: "Bucket", premium: true, covers: true, tint: true },
  { id: "cat_ears", label: "Touca de gatinho", premium: true, covers: true, tint: true, led: true },
  { id: "halo", label: "Auréola", premium: true, led: true },
  { id: "horns", label: "Chifrinhos", premium: true, led: true },
];
export const GLASSES_LED_COLORS = ["#2dd4bf", "#3b82f6", "#a855f7", "#ec4899", "#ef4444", "#f59e0b", "#22c55e", "#ffffff"];

/** Cabelos. `perBody`: um arquivo por corpo (modelados sob medida); `premium`: só apoiadores. */
export const HAIRS: { id: string; label: string; perBody?: boolean; premium?: boolean }[] = [
  { id: "none", label: "Sem cabelo" },
  { id: "hair_buzzed", label: "Raspado" },
  { id: "hair_buzzedfemale", label: "Raspado curto" },
  { id: "hair_simpleparted", label: "Repartido" },
  { id: "hair_long", label: "Longo" },
  { id: "hair_buns", label: "Coques" },
  { id: "hair_afro", label: "Black power", perBody: true, premium: true },
];

/** Itens de apoiador neste visual (para avisar e travar o salvar). */
export function premiumItems(look: Look): string[] {
  const out: string[] = [];
  const hair = HAIRS.find((h) => h.id === look.hair);
  if (hair?.premium) out.push(hair.label);
  if (look.glasses !== "none") out.push(GLASSES.find((g) => g.id === look.glasses)?.label ?? "Óculos");
  if (look.hat !== "none") out.push(HATS.find((h) => h.id === look.hat)?.label ?? "Acessório");
  if (look.outfit !== "none") out.push(OUTFITS.find((o) => o.id === look.outfit)?.label ?? "Roupa");
  if (look.pet !== "none") out.push(PETS.find((p) => p.id === look.pet)?.label ?? "Pet");
  for (const [list, v] of [[FACES, look.face], [NECKS, look.neck], [BACKS, look.back], [HANDS, look.hands]] as [Item<string>[], string][]) {
    if (v !== "none") out.push(list.find((i) => i.id === v)?.label ?? "Acessório");
  }
  return out;
}

/** Algum item escolhido usa a cor dos acessórios? */
export function hasTint(look: Look): boolean {
  return !!HATS.find((h) => h.id === look.hat)?.tint || !!NECKS.find((i) => i.id === look.neck)?.tint
    || !!BACKS.find((i) => i.id === look.back)?.tint || !!HANDS.find((i) => i.id === look.hands)?.tint;
}

/** O visual tem algo com LED (óculos gamer ou headset)? */
export function hasLed(look: Look): boolean {
  return look.glasses === "gamer" || look.glasses === "vr" || !!HATS.find((h) => h.id === look.hat)?.led
    || !!FACES.find((i) => i.id === look.face)?.led || !!BACKS.find((i) => i.id === look.back)?.led
    || !!HANDS.find((i) => i.id === look.hands)?.led || !!PETS.find((p) => p.id === look.pet)?.led;
}

/** Tons de pele: multiplicam a textura clara do modelo. */
export const SKIN_TONES = ["#ffffff", "#f3d7c2", "#e0b493", "#c38a64", "#9a6444", "#6e432c", "#4a2c1d"];
export const HAIR_COLORS = ["#2b1d14", "#5a3a22", "#8b5a2b", "#c89b5a", "#e6cf9c", "#9a2f1f", "#1f1f24", "#9aa3ad", "#2dd4bf", "#c084fc"];
export const CLOTH_COLORS = [
  "#0f172a", "#1e293b", "#334155", "#e2e8f0", "#ffffff", "#1d4ed8", "#0e7490", "#0d9488", "#15803d",
  "#ca8a04", "#c2410c", "#b91c1c", "#be185d", "#7c3aed", "#78350f", "#3f3f46",
];

// No Golfinho os modelos vêm do protocolo do app (o app instalado abre a interface do disco,
// e de lá o fetch não lê arquivos): ver officeAssets no processo principal.
const BASE = "golfinho-asset://office/avatars/";
/** No Escritório os personagens não projetam sombra no mapa (ele seria redesenhado a cada
 * passo): usam uma sombra de contato embaixo. A cena desliga isto ao abrir. */
export const AVATAR_OPTIONS = { castShadow: true };
/** Sobe quando algum modelo muda (o navegador baixa de novo em vez de usar o do cache). */
const ASSET_V = "15";
const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
function load(name: string): Promise<GLTF> {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(`${BASE}${name}.glb?v=${ASSET_V}`));
  return cache.get(name)!;
}

/** Visual inicial (sorteado a partir do id, para cada pessoa nascer diferente). */
export function defaultLook(seed: number): Look {
  let s = (seed * 2654435761) >>> 0;
  const pick = <T,>(a: T[]): T => { s = (s * 1103515245 + 12345) >>> 0; return a[s % a.length]; };
  const body: Body = pick(["male", "female"]);
  return {
    body,
    skin: pick(SKIN_TONES.slice(0, 6)),
    hair: body === "male" ? pick(["hair_buzzed", "hair_simpleparted", "hair_long"]) : pick(["hair_long", "hair_buns", "hair_simpleparted"]),
    hairColor: pick(HAIR_COLORS.slice(0, 7)),
    beard: body === "male" && pick([true, false, false]),
    shirt: pick(CLOTH_COLORS),
    sleeves: pick(["short", "long"]),
    pants: pick(["#0f172a", "#1e293b", "#334155", "#1d4ed8", "#78350f", "#3f3f46"]),
    shoes: pick(["#0f172a", "#ffffff", "#78350f", "#3f3f46"]),
    glasses: "none",
    hat: "none",
    hatColor: "#1d4ed8",
    face: "none",
    neck: "none",
    back: "none",
    hands: "none",
    pet: "none",
    petColor: "#d6a266",
    outfit: "none",
    outfitColor: "#1e293b",
    led: "#2dd4bf",
    ledMode: "fixo",
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Aceita só o que conhece (o JSON vem do servidor e de outras pessoas). */
export function parseLook(raw: unknown, seed: number): Look {
  const d = defaultLook(seed);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const color = (v: unknown, def: string) => (typeof v === "string" && HEX.test(v) ? v : def);
  return {
    body: r.body === "female" || r.body === "male" ? r.body : d.body,
    skin: color(r.skin, d.skin),
    hair: typeof r.hair === "string" && HAIRS.some((h) => h.id === r.hair) ? r.hair : d.hair,
    hairColor: color(r.hairColor, d.hairColor),
    beard: typeof r.beard === "boolean" ? r.beard : d.beard,
    shirt: color(r.shirt, d.shirt),
    sleeves: r.sleeves === "long" || r.sleeves === "short" ? r.sleeves : d.sleeves,
    pants: color(r.pants, d.pants),
    shoes: color(r.shoes, d.shoes),
    glasses: GLASSES.some((g) => g.id === r.glasses) ? (r.glasses as Glasses) : d.glasses,
    hat: HATS.some((h) => h.id === r.hat) ? (r.hat as Hat) : d.hat,
    hatColor: color(r.hatColor, d.hatColor),
    face: FACES.some((i) => i.id === r.face) ? (r.face as Face) : d.face,
    neck: NECKS.some((i) => i.id === r.neck) ? (r.neck as Neck) : d.neck,
    back: BACKS.some((i) => i.id === r.back) ? (r.back as Back) : d.back,
    hands: HANDS.some((i) => i.id === r.hands) ? (r.hands as Hands) : d.hands,
    pet: PETS.some((p) => p.id === r.pet) ? (r.pet as PetId) : d.pet,
    petColor: color(r.petColor, d.petColor),
    outfit: OUTFITS.some((o) => o.id === r.outfit) ? (r.outfit as Outfit) : d.outfit,
    outfitColor: color(r.outfitColor, d.outfitColor),
    led: color(r.led, d.led),
    ledMode: r.ledMode === "rgb" || r.ledMode === "pulsar" || r.ledMode === "fixo" ? r.ledMode : d.ledMode,
  };
}

// ---------- Roupa pintada (shader) ----------

/** Proporções medidas no modelo em pose T (fração da altura). */
const BODY_SHAPE: Record<Body, { height: number; wrist: number; shortSleeve: number }> = {
  male: { height: 1.82, wrist: 0.415, shortSleeve: 0.2 },
  female: { height: 1.775, wrist: 0.385, shortSleeve: 0.19 },
};

function clothesMaterial(src: THREE.MeshStandardMaterial, look: Look): THREE.MeshStandardMaterial {
  const m = src.clone();
  const shape = BODY_SHAPE[look.body];
  const u = {
    uHeight: { value: shape.height },
    uSkin: { value: new THREE.Color(look.skin) },
    uShirt: { value: new THREE.Color(look.shirt) },
    uPants: { value: new THREE.Color(look.pants) },
    uShoes: { value: new THREE.Color(look.shoes) },
    uSleeve: { value: look.sleeves === "long" ? shape.wrist : shape.shortSleeve },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBind;
        uniform float uHeight; uniform float uSleeve;
        uniform vec3 uSkin; uniform vec3 uShirt; uniform vec3 uPants; uniform vec3 uShoes;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float h = vBind.y / uHeight;
        float ax = abs(vBind.x) / uHeight;
        float shoes = 1.0 - smoothstep(0.046, 0.056, h);
        float legs = smoothstep(0.046, 0.056, h) * (1.0 - smoothstep(0.548, 0.562, h));
        float collar = mix(0.832, 0.872, smoothstep(0.035, 0.075, ax));
        float torso = smoothstep(0.548, 0.562, h) * (1.0 - smoothstep(collar - 0.006, collar + 0.006, h))
          * (1.0 - smoothstep(0.122, 0.134, ax));
        float arm = smoothstep(0.122, 0.134, ax) * smoothstep(0.69, 0.70, h) * (1.0 - smoothstep(0.885, 0.895, h));
        float sleeve = arm * (1.0 - smoothstep(uSleeve - 0.006, uSleeve + 0.006, ax));
        float shirtM = max(torso, sleeve);
        float clothM = max(shirtM, max(legs, shoes));
        diffuseColor.rgb *= uSkin;
        diffuseColor.rgb = mix(diffuseColor.rgb, uShirt, shirtM);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPants, legs);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShoes, shoes);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.88, clothM);",
      );
  };
  // Cada combinação de cores compila o mesmo programa (as cores são uniforms).
  m.customProgramCacheKey = () => "golfinho-clothes";
  return m;
}

// ---------- Personagem ----------

/** Animações (nomes no animations.glb) e a velocidade natural de cada uma, em m/s. */
const CLIPS = {
  idle: "Idle_Loop",
  talk: "Idle_Talking_Loop",
  walk: "Walk_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
  dance: "Dance_Loop",
  sit: "Sitting_Idle_Loop",
  sitTalk: "Sitting_Talking_Loop",
  wave: "Interact",
  jump: "Jump_Loop",
} as const;
/** Emotes do escritório: os do modelo (dança, aceno, pulo) e os feitos por código (palmas, rir, sentar no chão). */
export type EmoteKind = "dance" | "wave" | "jump" | "clap" | "laugh" | "sitfloor";
export const EMOTES: { id: EmoteKind; label: string; emoji: string; key: string }[] = [
  { id: "wave", label: "Acenar", emoji: "👋", key: "G" },
  { id: "dance", label: "Dançar", emoji: "💃", key: "B" },
  { id: "clap", label: "Palmas", emoji: "👏", key: "H" },
  { id: "laugh", label: "Rir", emoji: "😂", key: "L" },
  { id: "jump", label: "Pular", emoji: "🦘", key: "J" },
  { id: "sitfloor", label: "Sentar no chão", emoji: "🧘", key: "K" },
];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
type ClipKey = keyof typeof CLIPS;
const NATIVE_SPEED: Partial<Record<ClipKey, number>> = { walk: 1.35, jog: 3.1, sprint: 5.4 };

export class Character {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipKey, THREE.AnimationAction>();
  private current: ClipKey | null = null;
  private emote: ClipKey | null = null;
  private seated = false;
  private emoteUntil = 0;
  /** Emote feito por código por cima da animação (palmas, rir, pular, sentar no chão). */
  private gesture: EmoteKind | null = null;
  private gestureStart = 0;
  private boneMap = new Map<string, THREE.Bone>();
  private clock = 0;
  private token = 0;
  /** Materiais de LED dos acessórios (animados em update). */
  private leds: { color: THREE.Color }[] = [];
  private sparks: { geo: THREE.BufferGeometry; base: Float32Array; k: number } | null = null;

  /** Materiais dos acessórios pelo nome (LED, tela, véu, estampas, cor escolhida). */
  private styleAccessory(mesh: THREE.Mesh, look: Look) {
    mesh.castShadow = AVATAR_OPTIONS.castShadow;
    mesh.frustumCulled = false;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
      const mat = m as THREE.MeshStandardMaterial;
      if (/^LED/i.test(mat.name)) {
        const led = new THREE.MeshBasicMaterial({ color: look.led, toneMapped: false });
        this.leds.push(led);
        return led;
      }
      if (/^Screen/i.test(mat.name)) {
        const sc = new THREE.MeshBasicMaterial({ map: mat.map ?? mat.emissiveMap, color: look.led, toneMapped: false });
        this.leds.push(sc);
        return sc;
      }
      if (/^Membrane/i.test(mat.name)) {
        const v = new THREE.MeshBasicMaterial({
          color: look.led, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
        });
        this.leds.push(v);
        return v;
      }
      if (/Lens/i.test(mat.name)) {
        const lens = mat.clone();
        lens.transparent = true;
        lens.depthWrite = false;
        lens.opacity = Math.min(lens.opacity, 0.85);
        return lens;
      }
      if (/^(Print|Logo)/i.test(mat.name)) {
        const t = mat.clone();
        t.transparent = false;
        t.alphaTest = 0.5;
        return t;
      }
      if (/^HatBand/i.test(mat.name)) {
        const t = mat.clone();
        t.color = new THREE.Color(look.hatColor).multiplyScalar(0.6);
        return t;
      }
      if (/^Hat/i.test(mat.name)) {
        // Boné, gorro, cachecol, mochila... na cor escolhida (o tricô multiplica a textura).
        const t = mat.clone();
        t.color = new THREE.Color(look.hatColor).multiplyScalar(t.map ? 1.5 : 1);
        return t;
      }
      return mat;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  }
  look: Look;

  constructor(look: Look) {
    this.look = look;
    void this.build(look);
  }

  /** Troca o visual (recarrega as peças; as animações continuam). */
  setLook(look: Look) {
    if (JSON.stringify(look) === JSON.stringify(this.look)) return;
    const onlyLed = sameExceptLed(look, this.look);
    this.look = look;
    if (onlyLed) {
      // Só a cor/efeito do LED mudou: não precisa remontar o personagem.
      if (look.ledMode === "fixo") for (const m of this.leds) m.color.set(look.led);
      return;
    }
    void this.build(look);
  }

  /** Emote rápido (dança, aceno) por alguns segundos. */
  /** Sentado na cadeira: animação sentada (e sentada falando). */
  setSeated(on: boolean) {
    this.seated = on;
    this.emote = null;
  }

  playEmote(kind: EmoteKind) {
    const clip: Record<EmoteKind, ClipKey> = { dance: "dance", wave: "wave", jump: "jump", clap: "idle", laugh: "talk", sitfloor: "sit" };
    const dur: Record<EmoteKind, number> = { dance: 6, wave: 2.2, jump: 0.9, clap: 3.2, laugh: 3, sitfloor: 1e9 };
    this.emote = clip[kind];
    this.emoteUntil = this.clock + dur[kind];
    this.gesture = kind === "dance" || kind === "wave" ? null : kind;
    this.gestureStart = this.clock;
  }

  /** Mão segurando um objeto (ex.: o encosto da cadeira). `gripWeight` (0 a 1) mistura com a animação. */
  private grip: { target: THREE.Object3D; side: "l" | "r" } | null = null;
  gripWeight = 0;
  setGrip(target: THREE.Object3D | null, side: "l" | "r" = "l") {
    this.grip = target ? { target, side } : null;
  }

  private applyGrip() {
    const model = this.model;
    if (!model || !this.grip || this.gripWeight <= 0.001) return;
    const s = this.grip.side;
    const up = this.boneMap.get(`upperarm_${s}`), lo = this.boneMap.get(`lowerarm_${s}`), ha = this.boneMap.get(`hand_${s}`);
    if (!up || !lo || !ha) return;
    model.updateMatrixWorld(true);
    const q0 = up.quaternion.clone(), q1 = lo.quaternion.clone();
    // Cotovelo para baixo e um pouco para fora (do lado da mão).
    const origin = model.localToWorld(new THREE.Vector3(0, 0, 0));
    const out = model.localToWorld(new THREE.Vector3(s === "l" ? 1 : -1, 0, 0)).sub(origin).normalize();
    const pole = new THREE.Vector3(0, -1, 0).add(out.multiplyScalar(0.7)).normalize();
    this.reach(up, lo, ha, this.grip.target.getWorldPosition(new THREE.Vector3()), pole);
    const w = Math.min(1, this.gripWeight);
    up.quaternion.slerpQuaternions(q0, up.quaternion.clone(), w);
    lo.quaternion.slerpQuaternions(q1, lo.quaternion.clone(), w);
    up.updateMatrixWorld(true);
  }

  /** Braço alcança um ponto (IK de 2 ossos, cotovelo puxado para `pole`). */
  private reach(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
    const S = upper.getWorldPosition(_v1);
    const E = lower.getWorldPosition(_v2);
    const H = hand.getWorldPosition(_v3);
    const l1 = S.distanceTo(E), l2 = E.distanceTo(H);
    const toT = _v4.copy(target).sub(S);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const dir = toT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = S.clone().add(dir.clone().multiplyScalar(a)).add(p.multiplyScalar(h));
    const handTarget = S.clone().add(dir.clone().multiplyScalar(d));
    this.aim(upper, lower, elbow);
    this.aim(lower, hand, handTarget);
  }

  /** Gira o osso (no mundo) para o filho apontar para `target`. */
  private aim(bone: THREE.Bone, child: THREE.Object3D, target: THREE.Vector3) {
    const bp = bone.getWorldPosition(new THREE.Vector3());
    const cur = child.getWorldPosition(new THREE.Vector3()).sub(bp).normalize();
    const want = target.clone().sub(bp).normalize();
    _q1.setFromUnitVectors(cur, want);
    bone.getWorldQuaternion(_q2);
    _q1.multiply(_q2);
    bone.parent!.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q1));
    bone.updateMatrixWorld(true);
  }

  /** Inclina um osso em volta de um eixo do mundo (rir: tronco e cabeça balançando). */
  private tilt(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    _q1.setFromAxisAngle(axis, angle);
    bone.getWorldQuaternion(_q2);
    _q1.multiply(_q2);
    bone.parent!.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q1));
    bone.updateMatrixWorld(true);
  }

  private applyGesture() {
    const model = this.model;
    if (!model) return;
    const g = this.gesture;
    model.position.y = 0;
    if (!g) return;
    const t = this.clock - this.gestureStart;
    if (g === "jump") {
      const u = Math.min(1, t / 0.9);
      model.position.y = 0.42 * 4 * u * (1 - u);
      return;
    }
    if (g === "sitfloor") {
      model.position.y = -0.44; // a pose sentada fica no chão (sem cadeira)
      return;
    }
    model.updateMatrixWorld(true);
    const k = this.look.body === "male" ? 1 : 0.975;
    const b = (n: string) => this.boneMap.get(n);
    // Eixos do personagem (no espaço do modelo a frente é +Z e a esquerda é +X).
    const local = (x: number, y: number, z: number) => model.localToWorld(new THREE.Vector3(x, y, z));
    const right = local(1, 0, 0).sub(local(0, 0, 0)).normalize();
    const fade = Math.min(1, t / 0.25) * Math.min(1, (this.emoteUntil - this.clock) / 0.25);
    if (g === "clap") {
      const ul = b("upperarm_l"), ll = b("lowerarm_l"), hl = b("hand_l");
      const ur = b("upperarm_r"), lr = b("lowerarm_r"), hr = b("hand_r");
      if (!ul || !ll || !hl || !ur || !lr || !hr) return;
      // Mãos na frente do peito, abrindo e batendo umas 2 vezes por segundo.
      const open = 0.012 + 0.07 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 2.1));
      const y = 1.24 * k, z = 0.3 * fade + 0.08 * (1 - fade);
      const down = local(0, -1, -0.35).sub(local(0, 0, 0)).normalize();
      this.reach(ul, ll, hl, local(open * fade + 0.2 * (1 - fade), y - 0.35 * (1 - fade), z), down.clone().add(right.clone().multiplyScalar(-0.6)));
      this.reach(ur, lr, hr, local(-open * fade - 0.2 * (1 - fade), y - 0.35 * (1 - fade), z), down.clone().add(right.clone().multiplyScalar(0.6)));
    } else if (g === "laugh") {
      // Tronco balançando para a frente e para trás, cabeça jogada para trás.
      const sp = b("spine_03"), head = b("Head");
      if (sp) this.tilt(sp, right, (0.08 * Math.sin(t * 15) + 0.1) * fade);
      if (head) this.tilt(head, right, (-0.25 + 0.06 * Math.sin(t * 15 + 1)) * fade);
    }
  }

  private async build(look: Look) {
    const token = ++this.token;
    // Boné e gorro cobrem o cabelo todo: o cabelo nem carrega.
    const covered = !!HATS.find((h) => h.id === look.hat)?.covers;
    const extra = (slot: string, v: string) => v !== "none" ? load(`acc_${slot}_${v}_${look.body}`).catch(() => null) : Promise.resolve(null);
    const [body, anims, hair, beard, glasses, hat, outfit, face, neck, back, hands] = await Promise.all([
      load(look.body === "male" ? "body_male" : "body_female"),
      load("animations"),
      look.hair !== "none" && !covered ? load(HAIRS.find((h) => h.id === look.hair)?.perBody ? `${look.hair}_${look.body}` : look.hair) : Promise.resolve(null),
      look.beard ? load("hair_beard") : Promise.resolve(null),
      look.glasses !== "none" ? load(`acc_glasses_${look.glasses}_${look.body}`).catch(() => null) : Promise.resolve(null),
      look.hat !== "none" ? load(`acc_${look.hat}_${look.body}`).catch(() => null) : Promise.resolve(null),
      look.outfit !== "none" ? load(`outfit_${look.outfit}_${look.body}`).catch(() => null) : Promise.resolve(null),
      extra("face", look.face), extra("neck", look.neck), extra("back", look.back), extra("hands", look.hands),
    ]);
    if (token !== this.token) return; // chegou outro visual no meio do caminho

    const model = cloneSkinned(body.scene);
    model.rotation.y = Math.PI; // os modelos olham para +Z; no escritório, frente é -Z
    const bones = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        mesh.castShadow = AVATAR_OPTIONS.castShadow;
        mesh.frustumCulled = false; // a caixa da malha não acompanha a animação
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (/Superhero/i.test(mat.name)) mesh.material = clothesMaterial(mat, look);
        else if (/Hair/i.test(mat.name)) {
          // Sobrancelhas do corpo acompanham a cor do cabelo.
          const c = mat.clone();
          c.color = new THREE.Color(look.hairColor).multiplyScalar(1.6);
          mesh.material = c;
        }
      }
    });

    // Cabelo e barba: as malhas vêm com o mesmo esqueleto; religa nos ossos deste corpo.
    // Cabelos modelados por nós (black power) não têm esqueleto: são rígidos, presos no osso Head.
    for (const part of [hair, beard]) {
      if (!part) continue;
      const scene = cloneSkinned(part.scene);
      const meshes: THREE.SkinnedMesh[] = [];
      scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
      if (!meshes.length) {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          mat.color = new THREE.Color(look.hairColor).multiplyScalar(1.6);
          mesh.material = mat;
          mesh.castShadow = AVATAR_OPTIONS.castShadow;
          mesh.frustumCulled = false;
        });
        model.add(scene);
        const head = bones.get("Head");
        if (head) {
          model.updateMatrixWorld(true);
          head.attach(scene);
        }
        continue;
      }
      for (const m of meshes) {
        const mapped = m.skeleton.bones.map((b) => bones.get(b.name) ?? b);
        m.bind(new THREE.Skeleton(mapped, m.skeleton.boneInverses), m.bindMatrix);
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color = new THREE.Color(look.hairColor).multiplyScalar(1.6);
        m.material = mat;
        m.castShadow = AVATAR_OPTIONS.castShadow;
        m.frustumCulled = false;
        model.add(m);
      }
    }

    // Roupa por cima (jaqueta): malha com pesos nos ossos, religada no esqueleto deste corpo.
    if (outfit) {
      const scene = cloneSkinned(outfit.scene);
      const meshes: THREE.SkinnedMesh[] = [];
      scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
      for (const m of meshes) {
        const mapped = m.skeleton.bones.map((b) => bones.get(b.name) ?? b);
        m.bind(new THREE.Skeleton(mapped, m.skeleton.boneInverses), m.bindMatrix);
        const tint = (mat: THREE.MeshStandardMaterial) => {
          const c = mat.clone();
          if (/^Jacket/i.test(c.name)) c.color = new THREE.Color(look.outfitColor);
          else if (/^Rib/i.test(c.name)) c.color = new THREE.Color(look.outfitColor).multiplyScalar(0.62);
          else if (/^Logo/i.test(c.name)) { c.transparent = false; c.alphaTest = 0.5; }
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map((x) => tint(x as THREE.MeshStandardMaterial)) : tint(m.material as THREE.MeshStandardMaterial);
        m.castShadow = AVATAR_OPTIONS.castShadow;
        m.frustumCulled = false;
        model.add(m);
      }
    }

    // Acessórios. Rígidos (cabeça): modelados no espaço do corpo, na pose de referência; entram no
    // modelo e são "presos" no osso Head mantendo a posição. Do corpo (pescoço, costas, mãos): vêm com
    // pesos nos ossos e são religados no esqueleto deste corpo; com roupa por cima, a forma "over" põe a
    // peça por cima do tecido.
    this.leds = [];
    this.sparks = null;
    const over = OUTFIT_THICK[look.outfit] ?? 0;
    for (const part of [glasses, hat, face, neck, back, hands]) {
      if (!part) continue;
      let isSkinned = false;
      part.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) isSkinned = true; });
      if (isSkinned) {
        const scene = cloneSkinned(part.scene);
        const meshes: THREE.SkinnedMesh[] = [];
        scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
        for (const m of meshes) {
          const mapped = m.skeleton.bones.map((b) => bones.get(b.name) ?? b);
          m.bind(new THREE.Skeleton(mapped, m.skeleton.boneInverses), m.bindMatrix);
          this.styleAccessory(m, look);
          const k = m.morphTargetDictionary?.over;
          if (k !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[k] = over;
          model.add(m);
        }
        continue;
      }
      const acc = part.scene.clone(true);
      acc.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.styleAccessory(o as THREE.Mesh, look); });
      model.add(acc);
      const head = bones.get("Head");
      if (head) {
        model.updateMatrixWorld(true);
        head.attach(acc);
      }
    }
    // Asas: faíscas de luz caindo devagar (presas nas costas).
    if (look.back === "wings" && back) {
      const spine = bones.get("spine_03");
      const k = look.body === "male" ? 1 : 0.96;
      const n = 46;
      const pos = new Float32Array(n * 3);
      const rnd = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (rnd(i) * 2 - 1) * 0.5 * k;
        pos[i * 3 + 1] = (1.22 + rnd(i + 99) * 0.48) * k;
        pos[i * 3 + 2] = -(0.16 + rnd(i + 7) * 0.2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: look.led, size: 0.022, transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      model.add(pts);
      if (spine) {
        model.updateMatrixWorld(true);
        spine.attach(pts);
      }
      this.sparks = { geo, base: pos.slice(), k };
      this.leds.push(mat);
    }

    this.boneMap = bones;
    // Troca o modelo mantendo a animação que estava tocando.
    const keep = this.current;
    if (this.model) this.root.remove(this.model);
    this.mixer?.stopAllAction();
    this.model = model;
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions.clear();
    for (const [key, name] of Object.entries(CLIPS) as [ClipKey, string][]) {
      const clip = anims.animations.find((a) => a.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (key === "wave") action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(key, action);
    }
    this.current = null;
    this.play(keep ?? "idle", 0);
  }

  private play(key: ClipKey, fade = 0.25) {
    if (this.current === key) return;
    const next = this.actions.get(key);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.current = key;
  }

  /** Chamado a cada quadro com a velocidade real (m/s) e se a pessoa está falando. */
  update(dt: number, speed: number, speaking: boolean) {
    this.clock += dt;
    if (this.leds.length) this.animateLeds();
    if (this.sparks) this.animateSparks();
    if (!this.mixer) return;
    let key: ClipKey;
    if (this.seated) {
      key = speaking ? "sitTalk" : "sit";
      this.gesture = null;
    } else if (speed > 0.25) {
      this.emote = null;
      this.gesture = null;
      key = speed < 2.4 ? "walk" : speed < 4.6 ? "jog" : "sprint";
    } else if (this.emote && this.clock < this.emoteUntil) {
      key = this.emote;
    } else {
      this.emote = null;
      this.gesture = null;
      key = speaking ? "talk" : "idle";
    }
    this.play(key);
    const action = this.actions.get(key);
    const native = NATIVE_SPEED[key];
    if (action) action.timeScale = native ? THREE.MathUtils.clamp(speed / native, 0.6, 1.8) : 1;
    this.mixer.update(dt);
    this.applyGesture();
    this.applyGrip();
  }

  /** LED dos óculos: cor fixa, RGB correndo ou pulsando. */
  private ledColor = new THREE.Color();

  /** Faíscas das asas: caem devagar e voltam para cima, balançando para os lados. */
  private animateSparks() {
    const { geo, base, k } = this.sparks!;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length / 3; i++) {
      const speed = 0.05 + (i % 7) * 0.01;
      const t = (this.clock * speed + ((i * 0.137) % 1)) % 1;
      a[i * 3] = base[i * 3] + Math.sin(this.clock * 1.3 + i) * 0.015;
      a[i * 3 + 1] = (1.72 - t * 0.55) * k;
      a[i * 3 + 2] = base[i * 3 + 2] + Math.cos(this.clock * 0.9 + i) * 0.01;
    }
    pos.needsUpdate = true;
  }
  private animateLeds() {
    const c = this.ledColor.set(this.look.led);
    if (this.look.ledMode === "rgb") c.setHSL((this.clock * 0.15) % 1, 0.9, 0.55);
    else if (this.look.ledMode === "pulsar") {
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, hsl.s, Math.max(0.12, hsl.l * (0.55 + 0.45 * Math.sin(this.clock * 2.6))));
    }
    for (const m of this.leds) m.color.copy(c);
  }

  dispose() {
    this.token++;
    this.mixer?.stopAllAction();
    this.root.clear();
  }
}

/** Baixa as peças comuns antes (o escritório abre sem engasgar). */
/** Troca só o LED (sem recarregar o modelo). */
export function sameExceptLed(a: Look, b: Look): boolean {
  return JSON.stringify({ ...a, led: "", ledMode: "" }) === JSON.stringify({ ...b, led: "", ledMode: "" });
}

export function preloadAvatars() {
  for (const n of ["body_male", "body_female", "animations", "hair_beard"]) void load(n);
}
