import { it, expect } from "vitest";
import { Shells } from "../src/main/shells";
import type { Driver, Handle } from "../src/main/coordinator";
import type { Signal } from "../src/shared/contracts";
function setup() {
  const started: { command: string; args: string[]; cwd: string; exit: (c: number) => void }[] = [];
  const writes: string[] = [];
  const stops: number[] = [];
  const driver: Driver = {
    start: async (command, args, cwd, _data, exit) => {
      const index = started.push({ command, args, cwd, exit }) - 1;
      return {
        write: (text: string) => writes.push(text),
        resize() {},
        stop: () => stops.push(index),
      } as Handle;
    },
  };
  const signals: Signal[] = [];
  return { shells: new Shells(driver, (s) => signals.push(s)), started, writes, stops, signals };
}
it("abre o comando pedido na pasta indicada", async () => {
  const f = setup();
  const id = await f.shells.open("t1", "/wt/t1", "/bin/fakesh", ["-l"]);
  expect(f.started[0]).toMatchObject({ command: "/bin/fakesh", args: ["-l"], cwd: "/wt/t1" });
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
});
it("envia entrada e encerra só o shell pedido", async () => {
  const f = setup();
  const a = await f.shells.open("t1", "/wt/a", "/bin/fakesh", ["-l"]);
  const b = await f.shells.open("t2", "/wt/b", "/bin/fakesh", ["-l"]);
  f.shells.input(a, "ls\n");
  expect(f.writes).toEqual(["ls\n"]);
  f.shells.close(a);
  expect(f.stops).toEqual([0]);
  expect(() => f.shells.input(a, "x")).toThrow(/encerrado/);
  f.shells.input(b, "pwd\n");
  expect(f.writes).toEqual(["ls\n", "pwd\n"]);
});
it("emite a saída com o id do shell e avisa quando ele termina", async () => {
  const f = setup();
  const id = await f.shells.open("t1", "/wt/t1", "/bin/fakesh", []);
  f.started[0].exit(3);
  expect(f.signals).toEqual([{ kind: "shellEnded", id, code: 3 }]);
  expect(() => f.shells.input(id, "x")).toThrow(/encerrado/);
});
it("fecha todos os shells de uma tarefa ao excluí-la, sem tocar nos outros", async () => {
  const f = setup();
  await f.shells.open("t1", "/wt/a", "/bin/fakesh", []);
  await f.shells.open("t1", "/wt/a", "codex", []);
  await f.shells.open("t2", "/wt/b", "/bin/fakesh", []);
  f.shells.closeTask("t1");
  expect(f.stops).toEqual([0, 1]);
});
