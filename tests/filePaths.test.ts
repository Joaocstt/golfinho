import { describe, expect, it } from "vitest";
import { absolutePathIn, asFilePath } from "../src/renderer/filePaths";

describe("asFilePath", () => {
  it("reconhece arquivos citados no chat", () => {
    for (const p of ["DOCKER.md", "docker/entrypoint.sh", "docker-compose.yml", ".dockerignore", "Dockerfile", "./src/app.ts", "/home/u/x/README.md"])
      expect(asFilePath(p)).toBe(p);
  });
  it("tira a pontuação do fim", () => {
    expect(asFilePath("DOCKER.md,")).toBe("DOCKER.md");
  });
  it("ignora pastas, URLs, versões e comandos", () => {
    for (const p of ["app/", "vendor/", "main", "https://x.com/a.md", "1.2.3", "npm run dev", "0.1.32", ".", "mpac.local", "exemplo.com.br"])
      expect(asFilePath(p)).toBeNull();
  });
});

describe("absolutePathIn", () => {
  it("separa o caminho absoluto da linha de resultado", () => {
    expect(absolutePathIn("File created successfully at: /home/u/haki/DOCKER.md (file state is current)")).toEqual({
      before: "File created successfully at: ",
      path: "/home/u/haki/DOCKER.md",
      after: " (file state is current)",
    });
  });
  it("não acha nada sem caminho de arquivo", () => {
    expect(absolutePathIn("Command ran without output")).toBeNull();
    expect(absolutePathIn("listando /home/u/pasta/")).toBeNull();
  });
});
