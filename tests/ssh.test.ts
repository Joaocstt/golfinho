import { it, expect } from "vitest";
import { sshArgs, sshEnv, remoteQuote, remoteList, remoteRead, remoteRoots, MAX_REMOTE_FILE } from "../src/main/ssh";
import { vaultFrom } from "../src/main/vault";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import { requestSchema } from "../src/main/schema";
const vps = {
  id: "0199cf80-3b73-7252-9458-adfe7a905da5",
  name: "VPS",
  host: "203.0.113.10",
  user: "deploy",
  port: 2222,
  identityFile: "/home/jsantana/.ssh/id_ed25519",
};
it("monta o ssh com porta, chave e usuário, sem nenhuma opção de senha", () => {
  const args = sshArgs(vps);
  expect(args).toEqual(expect.arrayContaining(["-p", "2222", "-i", vps.identityFile, "deploy@203.0.113.10"]));
  expect(args.join(" ")).not.toMatch(/password|PASSWORD|sshpass/i);
});
it("na listagem o ssh nunca pede senha no meio do caminho", () => {
  expect(sshArgs(vps, true)).toContain("BatchMode=yes");
  expect(sshArgs(vps)).not.toContain("BatchMode=yes");
});
it("escapa o caminho remoto para o shell do servidor", () => {
  expect(remoteQuote("/srv/app")).toBe("'/srv/app'");
  expect(remoteQuote("/srv/it's; rm -rf /")).toBe("'/srv/it'\\''s; rm -rf /'");
});
it("lê a pasta remota: pastas primeiro, caminho real do servidor", async () => {
  const fake = async () => ({ stdout: "/srv/app\nsrc/\nconfig/\nREADME.md\n.env\n" });
  const listing = await remoteList(vps, "/srv/app", null, fake);
  expect(listing.path).toBe("/srv/app");
  expect(listing.entries).toEqual([
    { name: "config", kind: "directory" },
    { name: "src", kind: "directory" },
    { name: ".env", kind: "file" },
    { name: "README.md", kind: "file" },
  ]);
});
it("explica quando a conexão exige senha ou chave", async () => {
  const denied = async () => {
    throw Object.assign(new Error("x"), { stderr: "deploy@203.0.113.10: Permission denied (publickey,password)." });
  };
  await expect(remoteList(vps, "", null, denied)).rejects.toThrow(/guarde-a no perfil ou configure uma chave/);
});
it("valida o perfil: host e usuário sem espaços, chave com caminho absoluto", () => {
  const settings = (ssh: unknown) => ({
    action: "settings",
    settings: {
      concurrency: 2,
      executables: { codex: "codex", claude: "claude", antigravity: "agy" },
      setup: {},
      ssh: [ssh],
    },
  });
  expect(requestSchema.safeParse(settings(vps)).success).toBe(true);
  expect(requestSchema.safeParse(settings({ ...vps, host: "x; rm -rf /" })).success).toBe(false);
  expect(requestSchema.safeParse(settings({ ...vps, user: "a b" })).success).toBe(false);
  expect(requestSchema.safeParse(settings({ ...vps, identityFile: "relativa/chave" })).success).toBe(false);
  // Nenhum campo de senha é aceito: o schema recusa chaves extras.
  expect(requestSchema.safeParse(settings({ ...vps, password: "segredo" })).success).toBe(false);
});

it("a senha só existe no ambiente do processo, nunca nos argumentos", async () => {
  expect(sshEnv(null)).toEqual({});
  expect(sshEnv("segredo-123")).toMatchObject({ GOLFINHO_SSH_PASS: "segredo-123", SSH_ASKPASS_REQUIRE: "force" });
  expect(sshArgs(vps).join(" ")).not.toContain("segredo-123");
  const seen: { args: string[]; env: Record<string, string> }[] = [];
  await remoteList(vps, "", "segredo-123", async (_f, args, options) => {
    seen.push({ args, env: options.env });
    return { stdout: "/home/deploy\n" };
  });
  expect(seen[0].args.join(" ")).not.toContain("segredo-123");
  expect(seen[0].env.GOLFINHO_SSH_PASS).toBe("segredo-123");
  // Com senha, o ssh pode usar o askpass: não se desliga a autenticação interativa.
  expect(seen[0].args).not.toContain("BatchMode=yes");
});
it("o cofre cifra a senha: o valor guardado não é o texto original", () => {
  const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (t: string) => Buffer.from(`enc:${t}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ""),
  };
  const vault = vaultFrom(fakeSafeStorage);
  const body = vault.encrypt("senha-da-vps");
  expect(body).not.toContain("senha-da-vps");
  expect(vault.decrypt(body)).toBe("senha-da-vps");
});
it("não guarda senha quando o cofre do sistema está indisponível", async () => {
  const store = new Store(":memory:");
  store.saveSettings({ ...store.settings(), ssh: [vps] });
  const unavailable = vaultFrom({
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(""),
    decryptString: () => "",
  });
  const service = new Service(store, {} as GitService, {} as Coordinator, {} as never, () => {}, async () => null, undefined, undefined, unavailable);
  await expect(service.request({ action: "sshSavePassword", connectionId: vps.id, password: "x" })).rejects.toThrow(/cofre do sistema não está disponível/);
  expect(store.secret(vps.id)).toBeNull();
  store.close();
});
it("apaga a senha guardada quando o perfil é removido", async () => {
  const store = new Store(":memory:");
  const vault = vaultFrom({
    isEncryptionAvailable: () => true,
    encryptString: (t: string) => Buffer.from(t),
    decryptString: (b: Buffer) => b.toString(),
  });
  store.saveSettings({ ...store.settings(), ssh: [vps] });
  const coordinator = { pump: () => {} } as unknown as Coordinator;
  const service = new Service(store, {} as GitService, coordinator, {} as never, () => {}, async () => null, undefined, undefined, vault);
  await service.request({ action: "sshSavePassword", connectionId: vps.id, password: "senha" });
  expect(store.secret(vps.id)).not.toBeNull();
  await service.request({ action: "settings", settings: { ...store.settings(), ssh: [] } });
  expect(store.secret(vps.id)).toBeNull();
  store.close();
});

it("abre arquivo remoto só para leitura, com limite de tamanho", async () => {
  const seen: string[] = [];
  const text = await remoteRead(vps, "/srv/app/README.md", null, async (_f, args) => {
    seen.push(args[args.length - 1]);
    return { stdout: "# app\n" };
  });
  expect(text).toBe("# app\n");
  // O comando só testa, mede e lê: nada grava no servidor.
  expect(seen[0]).toMatch(/^test -f .* && \[ "\$\(stat -c %s -- .*\)" -le \d+ \] && cat -- /);
  expect(seen[0]).toContain(String(MAX_REMOTE_FILE));
  expect(seen[0]).not.toMatch(/>|rm |mv |tee /);
});
it("recusa arquivo binário na visualização", async () => {
  await expect(
    remoteRead(vps, "/srv/app/logo.png", null, async () => ({ stdout: "PNG\0\0" })),
  ).rejects.toThrow(/binário/);
});

it("lista início e discos do servidor, sem sistemas virtuais", async () => {
  const roots = await remoteRoots(vps, null, async () => ({
    stdout: "/home/aajunior\n/\n/proc\n/sys/fs/cgroup\n/run/user/1000\n/sigep\n/var/lib/docker/overlay\n/boot\n",
  }));
  expect(roots.home).toBe("/home/aajunior");
  expect(roots.mounts).toEqual(["/", "/boot", "/sigep"]);
});
