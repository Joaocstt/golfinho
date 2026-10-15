import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { killGroup } from "../src/main/pty";
// Grupos de processo são POSIX; no Windows o encerramento usa taskkill.
it.skipIf(process.platform === "win32")("encerra o líder do grupo com os filhos", async () => {
  const child = spawn("sh", ["-c", "sleep 30 & sleep 30"], { detached: true, stdio: "ignore" });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? -1 : 0))));
  await new Promise((resolve) => setTimeout(resolve, 200));
  killGroup(child.pid!, "SIGKILL");
  await expect(exited).resolves.toBe(-1);
});
