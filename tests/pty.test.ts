import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { childEnv, killGroup } from "../src/main/pty";
// Grupos de processo são POSIX; no Windows o encerramento usa taskkill.
it.skipIf(process.platform === "win32")("encerra o líder do grupo com os filhos", async () => {
  const child = spawn("sh", ["-c", "sleep 30 & sleep 30"], { detached: true, stdio: "ignore" });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? -1 : 0))));
  await new Promise((resolve) => setTimeout(resolve, 200));
  killGroup(child.pid!, "SIGKILL");
  await expect(exited).resolves.toBe(-1);
});

it("remove a sessão herdada do Claude Code e liga a gravação da transcrição", () => {
  const env = childEnv(
    { PATH: "/usr/bin", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_MESSAGING_TOKEN: "x", CLAUDE_CODE_EXECPATH: "/bin/claude" },
    { TERM: "xterm-256color" },
  );
  expect(env.PATH).toBe("/usr/bin");
  expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  expect(env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined();
  expect(env.CLAUDE_CODE_EXECPATH).toBe("/bin/claude");
  expect(env.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE).toBe("1");
  expect(env.TERM).toBe("xterm-256color");
});
