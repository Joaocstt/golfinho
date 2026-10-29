import { describe, expect, it } from "vitest";
import { linuxArg, linuxCommand, toUnc, wslChild, wslEnv, wslGit, wslHostAddress, wslLaunch, wslPath } from "../src/main/wsl";

const where = { distro: "Ubuntu", linux: "/home/joao/app" };
const head = ["-d", "Ubuntu", "--cd", "/home/joao/app", "--"];

describe("caminhos do WSL", () => {
  it("reconhece as duas formas de caminho de rede", () => {
    expect(wslPath("\\\\wsl.localhost\\Ubuntu\\home\\joao\\app")).toEqual(where);
    expect(wslPath("\\\\wsl$\\Ubuntu\\home\\joao\\app\\")).toEqual(where);
    expect(wslPath("//wsl.localhost/Ubuntu-22.04/home/x")).toEqual({ distro: "Ubuntu-22.04", linux: "/home/x" });
    expect(wslPath("\\\\wsl$\\Debian")).toEqual({ distro: "Debian", linux: "/" });
  });
  it("ignora caminhos que não são do WSL", () => {
    for (const p of ["C:\\Users\\joao\\app", "\\\\servidor\\share\\app", "/home/joao/app", "\\\\wslx\\Ubuntu\\a"])
      expect(wslPath(p)).toBeNull();
  });
  it("volta para o caminho de rede", () => {
    expect(toUnc("Ubuntu", "/home/joao/app")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\joao\\app");
    expect(wslPath(toUnc("Ubuntu", "/home/joao/app"))).toEqual(where);
  });
  it("traduz argumentos que são caminhos do Windows", () => {
    expect(linuxArg("\\\\wsl.localhost\\Ubuntu\\home\\joao\\wt\\1")).toBe("/home/joao/wt/1");
    expect(linuxArg("C:\\Users\\joao\\AppData\\mcp.json")).toBe("/mnt/c/Users/joao/AppData/mcp.json");
    expect(linuxArg("--permission-mode")).toBe("--permission-mode");
    expect(linuxArg("golfinho/minha-branch")).toBe("golfinho/minha-branch");
  });
});

describe("comandos dentro da distro", () => {
  it("git roda direto, com os caminhos traduzidos", () => {
    expect(wslGit(where, ["worktree", "add", "\\\\wsl.localhost\\Ubuntu\\home\\joao\\wt", "main"])).toEqual({
      file: "wsl.exe",
      args: [...head, "git", "worktree", "add", "/home/joao/wt", "main"],
    });
  });
  it("o agente roda num bash de login, pelo nome do comando no Linux", () => {
    expect(wslLaunch(where, "C:\\Users\\joao\\AppData\\Roaming\\npm\\claude.cmd", ["--", "faça x"])).toEqual({
      file: "wsl.exe",
      args: [...head, "bash", "-lc", 'exec "$0" "$@"', "claude", "--", "faça x"],
    });
    expect(linuxCommand("codex")).toBe("codex");
    expect(linuxCommand("/usr/local/bin/codex")).toBe("/usr/local/bin/codex");
  });
  it("setup, checks e shell interativo usam o bash da distro", () => {
    expect(wslLaunch(where, "C:\\Program Files\\Git\\bin\\bash.exe", ["-lc", "npm test"]).args).toEqual([...head, "bash", "-lc", "npm test"]);
    expect(wslLaunch(where, "C:\\Windows\\system32\\cmd.exe", ["/d", "/s", "/c", "npm ci"]).args).toEqual([...head, "bash", "-lc", "npm ci"]);
    expect(wslLaunch(where, "C:\\Program Files\\Git\\bin\\bash.exe", ["-l"]).args).toEqual([...head, "bash", "-l"]);
    expect(wslLaunch(where, "cmd.exe", []).args).toEqual([...head, "bash", "-l"]);
  });
  it("lista as variáveis extras em WSLENV, sem perder as que já estavam", () => {
    expect(wslEnv({ WSLENV: "USERPROFILE/p", A: "1" }, ["TERM", "A"]).WSLENV).toBe("USERPROFILE/p:TERM:A");
    expect(wslEnv({}, []).WSLENV).toBeUndefined();
  });
});

describe("memória e chat dentro da distro", () => {
  const nic = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal, netmask: "", mac: "", cidr: null });
  it("acha o endereço do Windows no adaptador do WSL", () => {
    expect(wslHostAddress({ "Ethernet": [nic("192.168.0.10")], "vEthernet (WSL (Hyper-V firewall))": [nic("172.24.16.1")] })).toBe("172.24.16.1");
  });
  it("sem adaptador do WSL (rede espelhada), não há endereço extra", () => {
    expect(wslHostAddress({ "Ethernet": [nic("192.168.0.10")], "Loopback": [nic("127.0.0.1", true)] })).toBeNull();
  });
  it("o processo do chat roda na distro e só leva as variáveis pedidas", () => {
    const child = wslChild(where, "codex", ["app-server"], { GOLFINHO_MEMORIA_TOKEN: "t", PATH: "C:\\x" }, ["GOLFINHO_MEMORIA_TOKEN"]);
    expect(child.file).toBe("wsl.exe");
    expect(child.args).toEqual([...head, "bash", "-lc", 'exec "$0" "$@"', "codex", "app-server"]);
    expect(child.options.env.WSLENV).toBe("GOLFINHO_MEMORIA_TOKEN");
  });
});
