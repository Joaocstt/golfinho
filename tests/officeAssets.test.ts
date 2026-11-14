import { expect, it } from "vitest";
import { join } from "node:path";
import { assetFile } from "../src/main/officeAssets";

const root = join("C:", "app", "office-assets");

it("acha o modelo dentro da pasta do Escritório", () => {
  expect(assetFile(root, "golfinho-asset://office/avatars/body_male.glb?v=15")).toBe(join(root, "avatars", "body_male.glb"));
});

it("não sai da pasta nem atende outro endereço", () => {
  // O URL já resolve "..": continua dentro da pasta. A barra codificada é que tentaria sair.
  expect(assetFile(root, "golfinho-asset://office/../x.glb")).toBe(join(root, "x.glb"));
  expect(assetFile(root, "golfinho-asset://office/avatars%2F..%2F..%2Fsegredo.txt")).toBeNull();
  expect(assetFile(root, "golfinho-asset://office/%2e%2e%5c%2e%2e%5csegredo.txt")).toBeNull();
  expect(assetFile(root, "golfinho-asset://outro/avatars/body_male.glb")).toBeNull();
  expect(assetFile(root, "https://office/avatars/body_male.glb")).toBeNull();
  expect(assetFile(root, "golfinho-asset://office/")).toBeNull();
});
