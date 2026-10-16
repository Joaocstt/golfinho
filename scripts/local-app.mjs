import { createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function localExecutable() {
  const electron = require("electron");
  if (process.platform !== "win32") return electron;

  // Keep the original runtime intact. The sibling executable shares its DLLs.
  const executable = join(dirname(electron), "Golfinho-dev.exe");
  const stamp = `${executable}.branding.json`;
  const icon = await readFile(join(root, "build/icon.ico"));
  const source = await stat(electron);
  const fingerprint = JSON.stringify({
    revision: 1,
    size: source.size,
    modified: source.mtimeMs,
    icon: createHash("sha256").update(icon).digest("hex"),
  });
  try {
    if ((await readFile(stamp, "utf8")) === fingerprint && (await stat(executable)).size > 0)
      return executable;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Use the same resource editor that is installed with electron-builder.
  const builderRequire = createRequire(require.resolve("app-builder-lib"));
  const { NtExecutable, NtExecutableResource, Resource, Data } = builderRequire("resedit");
  const exe = NtExecutable.from(await readFile(electron), { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const icons = Data.IconFile.from(icon).icons.map((item) => item.data);
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
  if (!groups.length) Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icons);
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, {
        ProductName: "Golfinho",
        FileDescription: "Golfinho (desenvolvimento)",
        InternalName: "Golfinho",
        OriginalFilename: "Golfinho-dev.exe",
      });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  try {
    await writeFile(executable, Buffer.from(exe.generate()));
    await writeFile(stamp, fingerprint);
  } catch (error) {
    if (["EBUSY", "EPERM", "EACCES"].includes(error.code)) {
      throw new Error("Feche o Golfinho local e execute o comando novamente para atualizar o ícone.", { cause: error });
    }
    throw error;
  }
  console.log("Ícone e nome do Golfinho aplicados ao executável local.");
  return executable;
}

const executable = await localExecutable();
if (process.argv[2] !== "--prepare") {
  const cli = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");
  const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, ELECTRON_EXEC_PATH: executable },
    stdio: "inherit",
  });
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
