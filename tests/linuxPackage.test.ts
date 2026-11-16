import { expect, it } from "vitest";
import { linuxPackage } from "../src/main/linuxPackage";

it("reconhece AppImage e .deb; snap e pacote desconhecido não se atualizam pelo app", () => {
  const fail = () => {
    throw new Error("sem arquivo");
  };
  expect(linuxPackage({ APPIMAGE: "/x/Golfinho.AppImage" }, fail)).toBe("appimage");
  expect(linuxPackage({}, () => "deb\n")).toBe("deb");
  expect(linuxPackage({ SNAP: "/snap/golfinho/1" }, () => "deb")).toBeNull();
  expect(linuxPackage({}, () => "rpm")).toBeNull();
  expect(linuxPackage({}, fail)).toBeNull();
});
