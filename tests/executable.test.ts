import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executablePath } from "../src/main/agents";
import { commandShell, gitBash, launchTarget } from "../src/main/shellCommand";
import { askpassFile, sshEnv } from "../src/main/ssh";
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const originalPath = process.env.PATH;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "golfinho-exec-"));
  process.env.PATH = dir;
});
afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform);
  process.env.PATH = originalPath;
  rmSync(dir, { recursive: true, force: true });
});
function asWindows() {
  Object.defineProperty(process, "platform", { value: "win32" });
}
it("no Windows ignora o script sem extensão do npm e usa o .cmd", () => {
  asWindows();
  writeFileSync(join(dir, "codex"), "#!/bin/sh\n");
  writeFileSync(join(dir, "codex.cmd"), "@echo off\r\n");
  writeFileSync(join(dir, "codex.ps1"), "");
  expect(executablePath("codex")).toBe(join(dir, "codex.cmd"));
});
it("no Windows prefere .exe quando existe", () => {
  asWindows();
  writeFileSync(join(dir, "claude"), "");
  writeFileSync(join(dir, "claude.exe"), "");
  expect(executablePath("claude")).toBe(join(dir, "claude.exe"));
});
it("no Windows retorna null quando só existe o script sem extensão", () => {
  asWindows();
  writeFileSync(join(dir, "codex"), "#!/bin/sh\n");
  expect(executablePath("codex")).toBeNull();
});
it("aceita comando com extensão já informada", () => {
  asWindows();
  writeFileSync(join(dir, "codex.cmd"), "");
  expect(executablePath("codex.cmd")).toBe(join(dir, "codex.cmd"));
});
it("shell de comandos no Windows usa o bash do Git quando existe, senão cmd; no POSIX usa bash", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const bash = gitBash();
  const shell = commandShell("npm ci");
  if (bash) expect(shell).toEqual({ file: bash, args: ["-lc", "npm ci"] });
  else expect(shell.args).toEqual(["/d", "/s", "/c", "npm ci"]);
  Object.defineProperty(process, "platform", { value: "linux" });
  expect(commandShell("npm ci")).toEqual({ file: "/bin/bash", args: ["-lc", "npm ci"] });
});
it("o askpass do Windows é um .cmd que imprime a senha pelo Electron como Node", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const script = askpassFile();
  expect(script.name).toBe("golfinho-askpass.cmd");
  expect(script.content).toContain("%GOLFINHO_NODE%");
  // A barra-n precisa chegar ao Node como texto, senão o -e quebra em duas linhas.
  expect(script.content).toContain("+ '\\n')");
  expect(sshEnv("segredo")).toMatchObject({ GOLFINHO_NODE: process.execPath, ELECTRON_RUN_AS_NODE: "1" });
  Object.defineProperty(process, "platform", { value: "linux" });
  expect(askpassFile().name).toBe("golfinho-askpass.sh");
});
it("executa .cmd pelo cmd no Windows, sem alterar o caminho de executáveis", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  expect(launchTarget("C:\\npm\\codex.cmd", ["/usage"]).args).toEqual(["/d", "/s", "/c", "C:\\npm\\codex.cmd", "/usage"]);
  expect(launchTarget("C:\\bin\\claude.exe", ["x"])).toEqual({ file: "C:\\bin\\claude.exe", args: ["x"] });
  Object.defineProperty(process, "platform", { value: "linux" });
  expect(launchTarget("/usr/bin/codex.cmd", [])).toEqual({ file: "/usr/bin/codex.cmd", args: [] });
});
