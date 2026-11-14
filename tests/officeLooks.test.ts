import { expect, it } from "vitest";
import { agentLook } from "../src/renderer/office3d/officeLooks";

const base = { id: "ana", color: "#e07a5f", hair: "#5a3825" };

it("o corpo segue o tratamento do agente, mesmo com um visual salvo", () => {
  expect(agentLook({ ...base, article: "a" }).body).toBe("female");
  expect(agentLook({ ...base, article: "o" }).body).toBe("male");
  const saved = { ...agentLook({ ...base, article: "o" }), beard: true };
  const now = agentLook({ ...base, article: "a", look: saved as unknown as Record<string, unknown> });
  expect(now).toMatchObject({ body: "female", beard: false });
});

it("sem tratamento (o chefe), o corpo é o que estiver salvo", () => {
  const look = agentLook(base);
  expect(["male", "female"]).toContain(look.body);
});
