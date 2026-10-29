import { describe, expect, it } from "vitest";
import { appBundle, isNewer, parseLatestMac, pickZip } from "../src/main/macUpdate";

const yml = `version: 0.1.32
files:
  - url: Golfinho-0.1.32-mac.zip
    sha512: intel==
    size: 279298677
  - url: Golfinho-0.1.32-arm64-mac.zip
    sha512: arm==
    size: 275707185
  - url: Golfinho-0.1.32.dmg
    sha512: dmg==
    size: 280733941
path: Golfinho-0.1.32-mac.zip
sha512: intel==
releaseDate: '2026-10-28T14:37:27.020Z'
`;

describe("atualização no macOS", () => {
  it("lê o latest-mac.yml e escolhe o zip da arquitetura", () => {
    const release = parseLatestMac(yml);
    expect(release.version).toBe("0.1.32");
    expect(release.files).toHaveLength(3);
    expect(pickZip(release, "arm64")).toEqual({ url: "Golfinho-0.1.32-arm64-mac.zip", sha512: "arm==", size: 275707185 });
    expect(pickZip(release, "x64")?.url).toBe("Golfinho-0.1.32-mac.zip");
  });
  it("compara versões", () => {
    expect(isNewer("0.1.33", "0.1.32")).toBe(true);
    expect(isNewer("0.2.0", "0.1.99")).toBe(true);
    expect(isNewer("0.1.32", "0.1.32")).toBe(false);
    expect(isNewer("0.1.9", "0.1.10")).toBe(false);
  });
  it("acha o Golfinho.app a partir do executável", () => {
    expect(appBundle("/Applications/Golfinho.app/Contents/MacOS/Golfinho")).toBe("/Applications/Golfinho.app");
    expect(appBundle("/usr/lib/golfinho/golfinho")).toBeNull();
  });
});
