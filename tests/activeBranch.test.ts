import { it, expect } from "vitest";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { Snapshot } from "../src/shared/contracts";
it("o snapshot traz a branch ativa de cada projeto e não falha se uma não puder ser lida", async () => {
  const store = new Store(":memory:");
  const ok = store.addProject({ id: "p-ok", name: "ok", path: "/repo/ok" } as never);
  const broken = store.addProject({ id: "p-quebrado", name: "quebrado", path: "/repo/quebrado" } as never);
  const git = {
    current: async (path: string) => {
      if (path === "/repo/ok") return "golfinho/teste";
      throw new Error("não é um repositório");
    },
  } as unknown as GitService;
  const coordinator = { ready: () => true } as unknown as Coordinator;
  const logs = { append() {}, replay: () => ({ data: "", nextOffset: 0 }), remove() {} };
  const service = new Service(store, git, coordinator, logs as never, () => {}, async () => null);
  const snapshot = (await service.request({ action: "snapshot" })) as Snapshot;
  expect(snapshot.activeBranches).toEqual({ [ok.id]: "golfinho/teste", [broken.id]: "" });
  store.close();
});
