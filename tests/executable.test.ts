import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
it("atalho .cmd do npm roda o programa real, e o prompt de várias linhas chega inteiro", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const exe = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin");
  mkdirSync(exe, { recursive: true });
  writeFileSync(join(exe, "claude.exe"), "");
  const claudeShim = [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    String.raw`"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`,
  ].join("\r\n");
  writeFileSync(join(dir, "claude.cmd"), claudeShim);
  const prompt = "Notas da memória\n\n---\n\nInstruções da tarefa";
  expect(launchTarget(join(dir, "claude.cmd"), ["--", prompt])).toEqual({
    file: join(exe, "claude.exe"),
    args: ["--", prompt],
  });
  // Codex: .js rodado pelo node que estiver ao lado do atalho.
  const js = join(dir, "node_modules", "@openai", "codex", "bin");
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, "codex.js"), "");
  writeFileSync(join(dir, "node.exe"), "");
  const codexShim = [
    "@SETLOCAL",
    String.raw`IF EXIST "%dp0%\node.exe" (`,
    String.raw`  SET "_prog=%dp0%\node.exe"`,
    ")",
    String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`,
  ].join("\r\n");
  writeFileSync(join(dir, "codex.cmd"), codexShim);
  expect(launchTarget(join(dir, "codex.cmd"), ["x"])).toEqual({ file: join(dir, "node.exe"), args: [join(js, "codex.js"), "x"] });
});
it("atalho .cmd desconhecido segue pelo cmd, sem quebras de linha que cortariam o argumento", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  writeFileSync(join(dir, "outro.cmd"), "@echo off\r\nfoo.exe %*\r\n");
  expect(launchTarget(join(dir, "outro.cmd"), ["a\nb"]).args).toEqual(["/d", "/s", "/c", join(dir, "outro.cmd"), "a b"]);
});
