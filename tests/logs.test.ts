import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalLogs } from "../src/main/logs";
import type { Signal } from "../src/shared/contracts";
let directory: string;
let signals: Extract<Signal, { kind: "terminal" }>[];
const make = () =>
  new TerminalLogs(directory, (s) => {
    if (s.kind === "terminal") signals.push(s);
  });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "golfinho-logs-"));
  signals = [];
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("agrupa pedaços em um sinal e uma escrita, sem perder ordem nem offset", async () => {
  const logs = make();
  for (const piece of ["um ", "dois ", "três"]) logs.append("t", piece);
  expect(signals).toHaveLength(0);
  expect(existsSync(join(directory, "t.log"))).toBe(false);
  await pause(60);
  expect(signals).toEqual([{ kind: "terminal", taskId: "t", data: "um dois três", offset: 0 }]);
  expect(readFileSync(join(directory, "t.log"), "utf8")).toBe("um dois três");
  logs.append("t", "!");
  await pause(60);
  expect(signals[1].offset).toBe(12);
  expect(readFileSync(join(directory, "t.log"), "utf8")).toBe("um dois três!");
});

it("descarrega sozinho quando o acúmulo passa do limite", () => {
  const logs = make();
  logs.append("t", "x".repeat(64 * 1024));
  expect(signals).toHaveLength(1);
  expect(signals[0].data).toHaveLength(64 * 1024);
});

it("replay enxerga o que ainda não foi descarregado e flush não duplica", async () => {
  const logs = make();
  logs.append("t", "pendente");
  expect(logs.replay("t")).toEqual({ data: "pendente", nextOffset: 8 });
  logs.flush();
  expect(signals).toHaveLength(1);
  expect(logs.replay("t")).toEqual({ data: "pendente", nextOffset: 8 });
  logs.flush();
  expect(signals).toHaveLength(1);
  await pause(60);
  expect(signals).toHaveLength(1);
});

it("libera a cauda das tarefas antigas mas mantém o offset crescente", async () => {
  const logs = make();
  logs.append("alvo", "começo");
  logs.flush();
  for (let i = 0; i < 25; i++) {
    logs.append(`outra-${i}`, "ruído");
    logs.flush();
  }
  // A entrada saiu da memória, mas o contador continua de onde parou.
  logs.append("alvo", "fim");
  logs.flush();
  const ultimo = signals.at(-1)!;
  expect(ultimo.taskId).toBe("alvo");
  expect(ultimo.offset).toBe(6);
  expect(logs.replay("alvo")).toEqual({ data: "começofim", nextOffset: 9 });
  expect(readFileSync(join(directory, "alvo.log"), "utf8")).toBe("começofim");
});

it("nunca descarta uma entrada com escrita pendente", () => {
  const logs = make();
  logs.append("pendurada", "guardar");
  for (let i = 0; i < 30; i++) logs.replay(`outra-${i}`);
  logs.flush();
  expect(signals).toHaveLength(1);
  expect(signals[0]).toMatchObject({ taskId: "pendurada", data: "guardar", offset: 0 });
});
