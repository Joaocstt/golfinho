import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { FileChange, Project, Review, Task } from "../shared/contracts";
import type { GitService } from "./git";

// Projeto "pasta": uma pasta que não é repositório Git, mas pode conter vários projetos,
// alguns com Git. A tarefa roda direto nela, sem branch; o agente recebe um mapa dos
// subprojetos e a revisão mostra o que mudou em cada repositório de dentro.

export const isFolderProject = (project: Project) => project.kind === "folder";
// Tarefa de pasta não tem branch: é por isso que as ações de Git a reconhecem.
export const isFolderTask = (task: Task) => task.branch === "";

// Pastas que nunca são subprojeto e que não vale a pena percorrer.
const SKIP = new Set(["node_modules", "vendor", "dist", "build", "out", "target", "venv", ".venv", "__pycache__"]);
const MAX_DEPTH = 3;
const MAX_DIRS = 400;

// Arquivos que dizem que tipo de projeto está numa pasta.
const MARKERS: [string, string][] = [
  ["package.json", "Node.js"],
  ["composer.json", "PHP"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["go.mod", "Go"],
  ["Cargo.toml", "Rust"],
  ["pom.xml", "Java (Maven)"],
  ["build.gradle", "Java/Kotlin (Gradle)"],
  ["build.gradle.kts", "Kotlin (Gradle)"],
  ["Gemfile", "Ruby"],
  ["pubspec.yaml", "Dart/Flutter"],
  ["mix.exs", "Elixir"],
  ["docker-compose.yml", "Docker Compose"],
  ["Dockerfile", "Docker"],
];

export interface Subproject {
  /** Caminho relativo à pasta do projeto, com "/". */
  path: string;
  git: boolean;
  kinds: string[];
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Subpastas que são repositório Git ou têm marca de projeto. Um repositório não é
// percorrido por dentro: o que está nele é dele.
export async function findSubprojects(root: string): Promise<Subproject[]> {
  const found: Subproject[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number) {
    if (visited++ > MAX_DIRS) return;
    const list = await entries(dir);
    const names = new Set(list.map((e) => e.name));
    const rel = relative(root, dir).split(sep).join("/");
    const git = names.has(".git");
    const kinds = [...new Set(MARKERS.filter(([file]) => names.has(file)).map(([, kind]) => kind))];
    if (rel && (git || kinds.length)) found.push({ path: rel, git, kinds });
    if (git && rel) return;
    if (depth >= MAX_DEPTH) return;
    for (const entry of list)
      if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name))
        await walk(join(dir, entry.name), depth + 1);
  }
  await walk(root, 0);
  // Pasta com marca de projeto dentro de outro projeto (ex.: packages/* de um monorepo
  // sem Git) continua listada: o agente precisa saber que ela existe.
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function readme(dir: string) {
  for (const name of ["README.md", "README", "readme.md", "README.txt"]) {
    try {
      const text = await readFile(join(dir, name), "utf8");
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("![") && !l.startsWith("<"))
        .slice(0, 3)
        .join(" ");
      return lines.length > 240 ? `${lines.slice(0, 240)}…` : lines;
    } catch {
      /* sem README com esse nome */
    }
  }
  return "";
}

// Mapa do workspace enviado ao agente na primeira mensagem de uma tarefa de pasta.
export async function workspaceMap(git: GitService, root: string): Promise<string> {
  const subprojects = await findSubprojects(root);
  const lines = [
    `Você está trabalhando na pasta "${basename(root)}" (${root}). Ela não é um repositório Git:`,
    "é um workspace que pode ter vários projetos. Leia este mapa antes de começar e trabalhe a",
    "partir da pasta certa. Commits, quando pedidos, são feitos dentro de cada subprojeto com Git.",
    "",
  ];
  if (!subprojects.length) lines.push("Nenhum subprojeto encontrado: a pasta ainda não tem projetos reconhecidos.");
  for (const sub of subprojects.slice(0, 60)) {
    const dir = join(root, sub.path);
    let gitInfo = "sem Git";
    if (sub.git) {
      try {
        const branch = (await git.current(dir)) || "HEAD destacado";
        const pending = await git.uncommitted(dir);
        gitInfo = `Git, branch ${branch}${pending ? `, ${pending} alteração(ões) pendente(s)` : ""}`;
      } catch {
        gitInfo = "Git (não foi possível ler o estado)";
      }
    }
    const about = await readme(dir);
    lines.push(`- ${sub.path}/ — ${sub.kinds.join(", ") || "projeto"}; ${gitInfo}${about ? `. ${about}` : ""}`);
  }
  if (subprojects.length > 60) lines.push(`- … e mais ${subprojects.length - 60} subprojeto(s).`);
  return lines.join("\n");
}

export function withWorkspace(map: string | null, prompt: string) {
  return map ? `${map}\n\n---\n\n${prompt}` : prompt;
}

// HEAD de cada repositório de dentro no início da tarefa: a revisão compara com ele,
// então commits que o agente fizer também aparecem.
export async function subrepoHeads(git: GitService, root: string): Promise<Record<string, string>> {
  const heads: Record<string, string> = {};
  for (const sub of await findSubprojects(root)) {
    if (!sub.git) continue;
    try {
      heads[sub.path] = await git.ref(join(root, sub.path), "HEAD");
    } catch {
      /* repositório sem commits: compara com nada */
    }
  }
  return heads;
}

// Revisão de uma tarefa de pasta: as alterações de cada repositório de dentro,
// com o caminho do arquivo prefixado pela pasta do repositório.
export async function folderReview(git: GitService, root: string, bases: Record<string, string>): Promise<Review> {
  const files: FileChange[] = [];
  for (const sub of await findSubprojects(root)) {
    if (!sub.git) continue;
    const dir = join(root, sub.path);
    try {
      const branch = await git.current(dir);
      const base = bases[sub.path] ?? (await git.ref(dir, "HEAD"));
      const review = await git.review(dir, branch || "HEAD", base);
      files.push(...review.files.map((f) => ({ ...f, path: `${sub.path}/${f.path}` })));
    } catch (e) {
      files.push({ path: `${sub.path}/`, status: "modified", original: "", modified: "", binary: false, error: (e as Error).message });
    }
    if (files.length > 200)
      throw new Error("Mais de 200 arquivos alterados. Reduza a tarefa para revisar no Golfinho.");
  }
  return { files, branch: "", overlaps: [] };
}

// Impressão digital de uma pasta para os checks: muda quando algum arquivo muda.
// Repositórios de dentro usam o fingerprint do Git; o resto, tamanho e data dos arquivos.
export async function folderFingerprint(git: GitService, root: string): Promise<string> {
  const hash = createHash("sha256");
  const subprojects = await findSubprojects(root);
  const repos = new Set(subprojects.filter((s) => s.git).map((s) => s.path));
  for (const path of repos) {
    try {
      hash.update(`${path}:${await git.fingerprint(join(root, path))}\n`);
    } catch {
      hash.update(`${path}:?\n`);
    }
  }
  let count = 0;
  const base = await realpath(root);
  async function walk(dir: string) {
    for (const entry of await entries(dir)) {
      if (count > 20000) return;
      const full = join(dir, entry.name);
      const rel = relative(base, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (entry.name === ".git" || SKIP.has(entry.name) || repos.has(rel)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        count++;
        try {
          const info = await stat(full);
          hash.update(`${rel}:${info.size}:${info.mtimeMs}\n`);
        } catch {
          /* apagado durante a leitura */
        }
      }
    }
  }
  await walk(base);
  return `folder:${hash.digest("hex")}`;
}
