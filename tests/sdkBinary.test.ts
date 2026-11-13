import { it, expect } from "vitest";
import { binaryPackages, unpackedPath } from "../src/main/sdkBinary";

it("binário dentro do app.asar passa a apontar para o app.asar.unpacked", () => {
  const win = String.raw`C:\Program Files\Golfinho\resources\app.asar\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`;
  expect(unpackedPath(win)).toBe(
    String.raw`C:\Program Files\Golfinho\resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe`,
  );
  expect(unpackedPath("/opt/Golfinho/resources/app.asar/node_modules/x/claude")).toBe(
    "/opt/Golfinho/resources/app.asar.unpacked/node_modules/x/claude",
  );
  // Rodando pelo código-fonte não há o que trocar; e o que já está fora não muda.
  expect(unpackedPath("C:/golfinho/node_modules/x/claude.exe")).toBe("C:/golfinho/node_modules/x/claude.exe");
  expect(unpackedPath("/a/app.asar.unpacked/x")).toBe("/a/app.asar.unpacked/x");
});

it("no Linux também tenta o binário musl", () => {
  expect(binaryPackages("win32", "x64")).toEqual(["@anthropic-ai/claude-agent-sdk-win32-x64"]);
  expect(binaryPackages("linux", "x64")).toEqual([
    "@anthropic-ai/claude-agent-sdk-linux-x64",
    "@anthropic-ai/claude-agent-sdk-linux-x64-musl",
  ]);
});
