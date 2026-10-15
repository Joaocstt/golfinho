import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const electron = require("electron");
const directory = await mkdtemp(join(tmpdir(), "golfinho-smoke-"));
let output = "";
try {
  const repo = join(directory, "repository");
  await mkdir(repo);
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "smoke@golfinho.test");
  git("config", "user.name", "Golfinho Smoke");
  await writeFile(join(repo, "README.md"), "Smoke fixture\n");
  git("add", ".");
  git("commit", "-m", "fixture");
  git("init", "--bare", join(directory, "remote.git"));
  git("remote", "add", "origin", join(directory, "remote.git"));
  const agent = join(directory, "test-agent");
  await writeFile(
    agent,
    '#!/bin/bash\nprintf "PTY_OK\\n"\necho "Agent fixture" > result.txt\ngit add result.txt\ngit commit -m "fixture task"\n',
  );
  await chmod(agent, 0o700);
  const env = {
    ...process.env,
    GOLFINHO_DATA_DIR: directory,
    GOLFINHO_SMOKE: "1",
    GOLFINHO_TEST_REPO: repo,
    GOLFINHO_TEST_AGENT: agent,
    GOLFINHO_SCREENSHOT: join(process.cwd(), "out", "smoke.png"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ["--disable-gpu", "--no-sandbox", "."], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  child.stdout.on("data", (data) => {
    output += data;
    process.stdout.write(data);
  });
  child.stderr.on("data", (data) => process.stderr.write(data));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  if (code !== 0 || !output.includes("GOLFINHO_SMOKE_OK"))
    throw new Error(`Electron smoke failed: ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
