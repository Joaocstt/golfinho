import assert from "node:assert/strict";
import type { Service } from "./service";
import type { Store } from "./store";
import type { Snapshot, Project, Task, Review } from "../shared/contracts";
import { ptyDriver } from "./pty";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const pause = () => new Promise((r) => setTimeout(r, 50));
async function until(fn: () => boolean) {
  const end = Date.now() + 15_000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Smoke test deadline reached.");
    await pause();
  }
}
export async function exercise(
  service: Service,
  store: Store,
  repository: string,
  executable: string,
) {
  let terminal = "";
  const ownedJob = await ptyDriver.start(
    "/bin/bash",
    ["-ic", "trap '' TERM; sleep 60 & echo CHILD:$!; wait"],
    repository,
    (text) => {
      terminal += text;
    },
    () => {},
  );
  await until(() => /CHILD:\d+/.test(terminal));
  const childPid = /CHILD:(\d+)/.exec(terminal)![1];
  ownedJob.stop();
  await ownedJob.closed;
  let alive = false;
  try {
    const stat = readFileSync(`/proc/${childPid}/stat`, "utf8");
    alive = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    /* reaped */
  }
  assert.equal(alive, false, "Jobs em outros grupos da sessão devem encerrar junto do terminal.");
  const project = (await service.request({ action: "addProject", path: repository })) as Project;
  await service.request({
    action: "settings",
    settings: {
      concurrency: 2,
      executables: { codex: executable, claude: executable, antigravity: executable },
      // Grava o diretório em que o setup roda, fora do repositório, para conferir depois.
      ssh: [],
      setup: {
        [project.id]: `printf '%s\\n' "$PWD" >> '${join(dirname(repository), "setup-runs.txt")}'`,
      },
    },
  });
  for (const provider of ["codex", "claude", "antigravity"] as const) {
    const task = (await service.request({
      action: "createTask",
      input: {
        projectId: project.id,
        title: `Validar ${provider}`,
        prompt: "Tarefa de teste local, sem API externa.",
        provider,
        branch: `golfinho/${provider}`,
        base: "main",
        remote: "origin",
        timeoutMinutes: 1,
      },
    })) as Task;
    await service.request({ action: "queue", taskId: task.id });
    await until(() => ["review", "failed"].includes(store.task(task.id).status));
    assert.equal(
      store.task(task.id).status,
      "review",
      store.task(task.id).error ?? "A CLI de teste deve encerrar em revisão.",
    );
    const review = (await service.request({ action: "review", taskId: task.id })) as Review;
    assert.equal(review.files.length, 1);
    await service.request({ action: "runCheck", taskId: task.id, command: 'printf "CHECK_OK\\n"' });
    await until(() => store.checks(task.id)[0]?.status !== "running");
    assert.equal(store.checks(task.id)[0]?.status, "passed");
    await service.request({ action: "finish", taskId: task.id });
    await service.request({ action: "publish", taskId: task.id });
    assert.equal(store.task(task.id).published, true);
  }
  const setupRuns = readFileSync(join(dirname(repository), "setup-runs.txt"), "utf8")
    .split("\n")
    .filter(Boolean);
  assert.equal(setupRuns.length, 3, "O setup deve rodar uma vez por tarefa nova.");
  assert.ok(
    setupRuns.every((dir) => dir !== repository),
    "O setup deve rodar na pasta da tarefa, nunca no repositório principal.",
  );
  const snapshot = (await service.request({ action: "snapshot" })) as Snapshot;
  return {
    setupRuns: setupRuns.length,
    projects: snapshot.projects.length,
    providers: snapshot.tasks.map((t) => t.provider),
    tasks: snapshot.tasks.length,
    passedChecks: snapshot.tasks.every((t) => store.checks(t.id)[0]?.status === "passed"),
    published: snapshot.tasks.every((t) => t.published),
    ownedJobCleanup: true,
  };
}
