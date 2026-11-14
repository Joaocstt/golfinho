import { expect, it } from "vitest";
import { jobBadge, tidyActivity } from "../src/renderer/OfficeSide";
import type { OfficeJob } from "../src/shared/office";

it("tira o cd e os caminhos inteiros da ação do agente", () => {
  expect(tidyActivity('Rodando: cd "C:/Users/User/Documents/senai-simulado" && npm test')).toBe("Rodando: npm test");
  expect(tidyActivity(String.raw`Lendo C:\Users\User\Documents\app\src\api.ts`)).toBe("Lendo api.ts");
  expect(tidyActivity("Buscando \"login\" no código")).toBe('Buscando "login" no código');
});

it("etiqueta curta de cada situação", () => {
  const base = { id: "j", agentId: "a", agentName: "A", title: "t", request: "r", activity: "", result: "", notes: [], read: false, createdAt: "" } as unknown as OfficeJob;
  expect(jobBadge({ ...base, status: "fazendo", approval: { id: "1", tool: "Bash", text: "x", canAlways: false } }).label).toBe("espera você");
  expect(jobBadge({ ...base, status: "fazendo", origin: "chat" }).label).toBe("no chat");
  expect(jobBadge({ ...base, status: "entregue", stage: "plano" }).label).toBe("aprovar plano");
  expect(jobBadge({ ...base, status: "erro", cancelled: true }).label).toBe("cancelado");
});
