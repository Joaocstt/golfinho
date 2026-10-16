import { it, expect, vi } from "vitest";
import { Store } from "../src/main/store";
import { Coordinator, type Driver, type Handle } from "../src/main/coordinator";
import { GitService, PendingChangesError } from "../src/main/git";
import { commandShell } from "../src/main/shellCommand";
function setup(
  finder?: (provider: string, cwd: string, since: number) => Promise<string | null>,
  prepare?: () => Promise<string>,
) {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  store.addProject({ id: "q", name: "Other", path: "/other", remotes: ["origin"] });
  const started: { cwd: string; args: string[]; exit: (code: number) => void; writes: string[] }[] = [];
  const driver: Driver = {
    start: async (_cmd, args, cwd, _data, exit) => {
      const entry = { cwd, args, exit, writes: [] as string[] };
      started.push(entry);
      return {
        write(text: string) {
          entry.writes.push(text);
        },
        resize() {},
        stop() {
          exit(0);
        },
      } as Handle;
    },
  };
  const git = {
    prepare: prepare ?? (async () => "abc"),
    prepareWorktree: async () => "abc",
    requireCurrent: async () => {},
    fingerprint: async () => "rev",
  } as unknown as GitService;
  const c = new Coordinator(
    store,
    git,
    driver,
    {
      append() {},
      replay() {
        return { data: "", nextOffset: 0 };
      },
      remove() {},
    },
    () => {},
    "/wt",
    finder as never,
  );
  const create = (projectId: string, branch: string) =>
    store.createTask({
      projectId,
      branch,
      title: branch,
      prompt: "x",
      provider: "codex",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
  return { store, c, started, create };
}
const tick = () => new Promise((r) => setTimeout(r, 20));
it("runs tasks of one repository one at a time in the project folder; other repositories run in parallel", async () => {
  const { store, c, started, create } = setup();
  const a = create("p", "golfinho/a"),
    b = create("p", "golfinho/b"),
    other = create("q", "golfinho/o");
  c.queue(a.id);
  c.queue(b.id);
  c.queue(other.id);
  await tick();
  // Uma pasta por projeto: a segunda tarefa do mesmo projeto espera; o outro projeto roda junto.
  expect(started.map((s) => s.cwd)).toEqual(["/repo", "/other"]);
  expect(store.task(b.id).status).toBe("queued");
  started[0].exit(0);
  await tick();
  expect(store.task(a.id).status).toBe("review");
  expect(started.map((s) => s.cwd)).toEqual(["/repo", "/other", "/repo"]);
  c.shutdown();
  store.close();
});
it("does not relaunch a cancelled task and rejects operations while the repository is owned", async () => {
  const { store, c, started, create } = setup();
  const a = create("p", "golfinho/a");
  c.queue(a.id);
  await tick();
  await expect(c.exclusive(a.id, async () => null)).rejects.toThrow(/execução/i);
  c.cancel(a.id);
  await tick();
  expect(store.task(a.id).status).toBe("cancelled");
  expect(started.length).toBe(1);
  c.shutdown();
  store.close();
});
it("keeps a cancelled worktree owned until its process acknowledges exit", async () => {
  const { store, c, started, create } = setup();
  const a = create("p", "golfinho/a"),
    b = create("q", "golfinho/b");
  // start a driver whose stop request does not immediately end the process.
  const driver: Driver = {
    start: async (_c, args, cwd, _d, exit) => {
      started.push({ cwd, args, exit, writes: [] });
      return { write() {}, resize() {}, stop() {} };
    },
  };
  const git = {
    prepare: async () => "abc",
    prepareWorktree: async () => "abc",
    requireCurrent: async () => {},
  } as unknown as GitService;
  const runner = new Coordinator(
    store,
    git,
    driver,
    {
      append() {},
      replay() {
        return { data: "", nextOffset: 0 };
      },
      remove() {},
    },
    () => {},
    "/wt",
  );
  runner.queue(a.id);
  runner.queue(b.id);
  await tick();
  runner.cancel(a.id);
  await tick();
  // A pasta de a segue ocupada até o processo confirmar a saída...
  await expect(runner.exclusive(a.id, async () => null)).rejects.toThrow(/execução/i);
  // ...mas b, de outro projeto, não espera.
  expect(store.task(b.id).status).toBe("running");
  started[0].exit(0);
  await tick();
  await expect(runner.exclusive(a.id, async () => null)).resolves.toBeNull();
  await runner.shutdown();
  await c.shutdown();
  store.close();
});
it("queues a check when the limit is full instead of failing the request", async () => {
  const { store, c, started, create } = setup();
  store.saveSettings({ ...store.settings(), concurrency: 1 });
  const busy = create("q", "golfinho/busy");
  const target = create("p", "golfinho/target");
  store.transition(target.id, "queued", "x");
  store.transition(target.id, "running", "x");
  store.transition(target.id, "review", "x");
  store.update(target.id, { branchCreated: true }, "x");
  c.queue(busy.id);
  await tick();
  expect(store.task(busy.id).status).toBe("running");
  let settled = false;
  const check = c.runCheck(target.id, "echo ok").then(() => {
    settled = true;
  });
  await tick();
  // A vaga única está com a execução; o check espera em vez de recusar.
  expect(settled).toBe(false);
  expect(store.events(target.id).some((e) => /aguardando vaga/i.test(e.message))).toBe(true);
  expect(store.checks(target.id)).toHaveLength(0);
  started.find((s) => s.cwd === "/other")!.exit(0);
  await tick();
  // Com a vaga livre o check arranca sozinho, sem o usuário repetir a ação.
  const run = started.find((s) => s.cwd === "/repo");
  expect(run).toBeTruthy();
  expect(store.checks(target.id)).toHaveLength(1);
  run!.exit(0);
  await check;
  expect(settled).toBe(true);
  expect(store.checks(target.id)[0].status).toBe("passed");
  await c.shutdown();
  store.close();
});
it("applies requested dimensions after delayed terminal startup and reports readiness", async () => {
  const { store, c, create } = setup();
  const task = create("p", "golfinho/dimensions");
  const resizeCalls: number[][] = [];
  let resolveStart!: (h: Handle) => void;
  let end!: (code: number) => void;
  const driver: Driver = { start: (_cmd, _args, _cwd, _data, exit) => { end = exit; return new Promise(resolve => { resolveStart = resolve; }); } };
  const runner = new Coordinator(store, { prepare: async()=>"abc", prepareWorktree: async()=>"abc" } as unknown as GitService, driver, {append(){},replay(){return{data:"",nextOffset:0};},remove(){}}, ()=>{}, "/wt");
  runner.queue(task.id); await tick();
  expect(runner.ready(task.id)).toBe(false);
  runner.resize(task.id, 143, 41);
  resolveStart({write(){},resize(cols,rows){resizeCalls.push([cols,rows]);},stop(){end(0);}});
  await tick(); expect(runner.ready(task.id)).toBe(true); expect(resizeCalls).toEqual([[143,41]]);
  await runner.shutdown(); await c.shutdown(); store.close();
});

it("registra a sessão da CLI e retoma sem reenviar o prompt", async () => {
  vi.useFakeTimers();
  try {
    const { store, c, started, create } = setup(async () => "sessao-abc");
    const task = create("p", "golfinho/retoma");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    // Primeira execução: conversa nova, com as instruções da tarefa.
    expect(started[0].args).toContain("x");
    expect(store.task(task.id).sessionId).toBeFalsy();

    await vi.advanceTimersByTimeAsync(2000);
    expect(store.task(task.id).sessionId).toBe("sessao-abc");

    started[0].exit(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(store.task(task.id).status).toBe("review");

    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    // Retomada: reabre a conversa e não manda o prompt de novo.
    expect(started[1].args.slice(0, 2)).toEqual(["resume", "sessao-abc"]);
    expect(started[1].args).not.toContain("x");
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});

it("troca o id guardado quando a retomada abre um rollout novo", async () => {
  vi.useFakeTimers();
  try {
    let atual = "sessao-1";
    const { store, c, started, create } = setup(async () => atual);
    const task = create("p", "golfinho/fork");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.task(task.id).sessionId).toBe("sessao-1");
    started[0].exit(0);
    await vi.advanceTimersByTimeAsync(50);

    // A CLI retoma e grava a conversa num arquivo novo, com outro id.
    atual = "sessao-2";
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    expect(started[1].args.slice(0, 2)).toEqual(["resume", "sessao-1"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.task(task.id).sessionId).toBe("sessao-2");

    // A retomada seguinte usa o id novo; o antigo perderia tudo desta execução.
    started[1].exit(0);
    await vi.advanceTimersByTimeAsync(50);
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    expect(started[2].args.slice(0, 2)).toEqual(["resume", "sessao-2"]);
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});

it("segue com conversa nova quando a sessão não pode ser descoberta", async () => {
  vi.useFakeTimers();
  try {
    const { store, c, started, create } = setup(async () => null);
    const task = create("p", "golfinho/sem-sessao");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.task(task.id).sessionId).toBeFalsy();
    started[0].exit(0);
    await vi.advanceTimersByTimeAsync(50);
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    expect(started[1].args).toContain("x");
    expect(started[1].args).not.toContain("resume");
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});

it("runs the project setup in the new folder before the CLI, and marks it done", async () => {
  const { store, c, started, create } = setup();
  store.saveSettings({ ...store.settings(), setup: { p: "npm ci" } });
  const task = create("p", "golfinho/setup");
  c.queue(task.id);
  await tick();
  // Primeiro processo é o setup, na pasta da tarefa; a CLI ainda não subiu.
  expect(started).toHaveLength(1);
  expect(started[0].args).toEqual(commandShell("npm ci").args);
  expect(started[0].cwd).toBe("/repo");
  started[0].exit(0);
  await tick();
  expect(started).toHaveLength(2);
  expect(started[1].args).toContain("--");
  expect(started[1].cwd).toBe(started[0].cwd);
  expect(store.task(task.id).setupDone).toBe(true);
  await c.shutdown();
  store.close();
});

it("fails the task and never starts the CLI when the setup fails", async () => {
  const { store, c, started, create } = setup();
  store.saveSettings({ ...store.settings(), setup: { p: "npm ci" } });
  const task = create("p", "golfinho/setup-falha");
  c.queue(task.id);
  await tick();
  started[0].exit(1);
  await tick();
  expect(started).toHaveLength(1);
  expect(store.task(task.id).status).toBe("failed");
  expect(store.task(task.id).error).toMatch(/Setup falhou com código 1/);
  expect(store.task(task.id).setupDone).toBeFalsy();
  await c.shutdown();
  store.close();
});

it("skips the setup when the folder was already prepared", async () => {
  const { store, c, started, create } = setup();
  store.saveSettings({ ...store.settings(), setup: { p: "npm ci" } });
  const task = create("p", "golfinho/setup-feito");
  store.update(task.id, { setupDone: true }, "x");
  c.queue(task.id);
  await tick();
  expect(started).toHaveLength(1);
  expect(started[0].args).not.toEqual(commandShell("npm ci").args);
  await c.shutdown();
  store.close();
});

it("encerra pelo comando de saída e leva à revisão, mesmo com código diferente de zero", async () => {
  vi.useFakeTimers();
  try {
    const { store, c, started, create } = setup();
    const task = create("p", "golfinho/fim");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    c.endSession(task.id);
    expect(started[0].writes).toEqual(["/exit\r"]);
    expect(store.task(task.id).status).toBe("running");
    started[0].exit(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(store.task(task.id).status).toBe("review");
    expect(store.events(task.id).some((e) => /Encerrada pelo usuário/.test(e.message))).toBe(true);
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});
it("para a CLI à força se ela não sair do comando de saída, sem perder a revisão", async () => {
  vi.useFakeTimers();
  try {
    const { store, c, started, create } = setup();
    const task = create("p", "golfinho/travado");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(50);
    c.endSession(task.id);
    await vi.advanceTimersByTimeAsync(15_000);
    // O mock do driver encerra ao receber stop(); o efeito é o mesmo de um processo travado.
    await vi.advanceTimersByTimeAsync(50);
    expect(started[0].writes).toEqual(["/exit\r"]);
    expect(store.task(task.id).status).toBe("review");
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});
it("recusa encerrar agente sem comando de saída verificado", async () => {
  const { store, c, started } = setup();
  const agy = store.createTask({
    projectId: "p",
    branch: "golfinho/agy",
    title: "agy",
    prompt: "x",
    provider: "antigravity",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  c.queue(agy.id);
  await tick();
  expect(() => c.endSession(agy.id)).toThrow(/comando de saída verificado/);
  expect(started.every((s) => s.writes.length === 0)).toBe(true);
  await c.shutdown();
  store.close();
});

it("keeps the task queued with a warning, not failed, when the project folder has pending changes", async () => {
  const { store, c, started, create } = setup(undefined, async () => {
    throw new PendingChangesError("Há alterações locais.");
  });
  const a = create("p", "golfinho/a");
  c.queue(a.id);
  await tick();
  expect(started).toHaveLength(0);
  expect(store.task(a.id).status).toBe("queued");
  expect(store.events(a.id).some((e) => /alterações não commitadas/.test(e.message))).toBe(true);
  c.shutdown();
  store.close();
});

it("não retoma no terminal a conversa do chat e a exclui da descoberta", async () => {
  vi.useFakeTimers();
  try {
    const excludes: (string[] | undefined)[] = [];
    const { store, c, started, create } = setup(async (_provider, _cwd, _since, exclude?: string[]) => {
      excludes.push(exclude);
      return null;
    });
    const task = create("p", "golfinho/chat-e-terminal");
    store.setChatSession(task.id, "chat-1");
    // Id gravado por uma detecção antiga, que confundiu a conversa do chat com a da CLI.
    store.update(task.id, { sessionId: "chat-1" }, "id antigo");
    c.queue(task.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(started[0].args).not.toContain("resume");
    expect(excludes[0]).toEqual(["chat-1"]);
    await c.shutdown();
    store.close();
  } finally {
    vi.useRealTimers();
  }
});
