// Sons do Escritório, gerados com Web Audio (sem arquivos), no estilo dos do Golfinho Call:
// curtos e suaves. Entrega na mesa, erro, pedido de permissão e o início de uma reunião.

export type OfficeSound = "entrega" | "erro" | "permissao" | "reuniao";

const KEY = "golfinho.escritorio.sons";
let ctx: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* sem storage: vale só nesta sessão */
  }
}

/** Uma nota com ataque rápido e queda suave. */
function tone(c: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine", glideTo?: number) {
  const osc = new OscillatorNode(c, { type, frequency: freq });
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  const g = new GainNode(c, { gain: 0 });
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function play(sound: OfficeSound) {
  if (!soundsEnabled() || typeof AudioContext === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    return;
  }
  const c = ctx;
  const t = c.currentTime + 0.01;
  switch (sound) {
    case "entrega": // acorde subindo: chegou algo na sua mesa
      tone(c, 523.25, t, 0.18, 0.1);
      tone(c, 659.25, t + 0.07, 0.2, 0.09);
      tone(c, 783.99, t + 0.14, 0.32, 0.09);
      break;
    case "erro": // duas notas descendo, mais graves
      tone(c, 440, t, 0.18, 0.09, "triangle");
      tone(c, 311.13, t + 0.12, 0.32, 0.09, "triangle");
      break;
    case "permissao": // três notas: alguém chamou você
      tone(c, 1046.5, t, 0.1, 0.07);
      tone(c, 1318.5, t + 0.07, 0.1, 0.07);
      tone(c, 1568, t + 0.14, 0.2, 0.06);
      break;
    case "reuniao": // "plim" duplo
      tone(c, 1318.5, t, 0.12, 0.06);
      tone(c, 1760, t + 0.06, 0.18, 0.05);
      break;
  }
}
