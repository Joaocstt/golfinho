import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatImages, MAX_IMAGE_BYTES } from "../src/main/chatImages";
let root: string;
let images: ChatImages;
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "golfinho-images-"));
  mkdirSync(join(root, "clipboard"));
  images = new ChatImages(join(root, "chat-images"), [join(root, "chat-images"), join(root, "clipboard")]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("importa uma imagem escolhida para a pasta do chat e gera o preview", async () => {
  const source = join(root, "foto.PNG");
  writeFileSync(source, PNG);
  const copied = await images.import(source);
  expect(copied.startsWith(join(root, "chat-images"))).toBe(true);
  expect(copied.endsWith(".png")).toBe(true);
  expect(await images.dataUrl(copied)).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
});
it("aceita imagem colada (pasta clipboard)", async () => {
  const pasted = join(root, "clipboard", "colada.png");
  writeFileSync(pasted, PNG);
  await expect(images.verify(pasted)).resolves.toMatchObject({ mediaType: "image/png" });
});
it("recusa caminho fora das pastas do app", async () => {
  const outside = join(root, "solta.png");
  writeFileSync(outside, PNG);
  await expect(images.verify(outside)).rejects.toThrow("anexada pelo chat");
});
it("aceita imagens de até 20 MiB e recusa formatos ou tamanhos inválidos", async () => {
  const text = join(root, "clipboard", "notas.txt");
  writeFileSync(text, "x");
  await expect(images.verify(text)).rejects.toThrow("Formato não suportado");
  const tenMiB = join(root, "dez-mib.png");
  writeFileSync(tenMiB, Buffer.alloc(10 * 1024 * 1024));
  await expect(images.import(tenMiB)).resolves.toMatch(/chat-images/);
  const big = join(root, "grande.png");
  writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1));
  await expect(images.import(big)).rejects.toThrow("20 MiB");
});
it("recusa caminho relativo", async () => {
  await expect(images.verify("clipboard/x.png")).rejects.toThrow("inválido");
});
