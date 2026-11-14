// Personagem e mesa de cada um no Escritório, a partir do que está salvo na sala. Quem nunca foi
// personalizado ganha um visual sorteado pelo id, com a camisa na cor do agente, e a mesa gamer.
import type { OfficeAgent, OfficeLayout } from "../../shared/office";
import { defaultLook, parseLook, type Look } from "./avatar";
import { DEFAULT_DESK, parseDesk, type DeskStyle } from "./desk3d";

const HEX = /^#[0-9a-f]{6}$/i;

/** Número estável a partir de um texto (o id do agente), para o sorteio do visual. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Corpo pelo tratamento do agente: "a" (ela) feminino, "o" (ele) masculino. */
export const bodyOf = (article: OfficeAgent["article"]): Look["body"] => (article === "a" ? "female" : "male");

export function agentLook(a: Pick<OfficeAgent, "id" | "color" | "hair" | "look"> & Partial<Pick<OfficeAgent, "article">>): Look {
  const look = a.look
    ? parseLook(a.look, seedOf(a.id))
    : (() => {
        const d = defaultLook(seedOf(a.id));
        return { ...d, shirt: HEX.test(a.color) ? a.color : d.shirt, hairColor: HEX.test(a.hair) ? a.hair : d.hairColor };
      })();
  if (!a.article) return look;
  // O corpo segue o "a/o": trocar o tratamento troca o corpo, e mulher não tem barba.
  const body = bodyOf(a.article);
  if (look.body === body) return look;
  return { ...look, body, beard: body === "male" && look.beard };
}

/** Setup gamer de quem nunca mexeu na mesa: dois monitores, teclado e LED na cor do agente. */
export function agentDesk(a: Pick<OfficeAgent, "color" | "deskStyle">): DeskStyle {
  if (a.deskStyle) return parseDesk(a.deskStyle);
  return {
    ...DEFAULT_DESK,
    monitors: 2,
    leds: "fixo",
    ledColor: HEX.test(a.color) ? a.color : DEFAULT_DESK.ledColor,
    keyboard: "gamer",
    lamp: false,
    headphones: true,
    chair: "gamer",
    pc: "medio",
  };
}

/** O chefe: terno escuro, se ainda não foi personalizado. */
export function bossLook(layout: Pick<OfficeLayout, "bossLook">): Look {
  if (layout.bossLook) return parseLook(layout.bossLook, seedOf("chefe"));
  return { ...defaultLook(seedOf("chefe")), shirt: "#22305a", outfit: "jacket", outfitColor: "#1f2937", pants: "#1e293b" };
}

/** Chave para saber se o personagem precisa ser remontado. */
export const lookKey = (look: Look) => JSON.stringify(look);
export const deskKey = (style: DeskStyle) => JSON.stringify(style);
