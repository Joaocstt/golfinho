import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // Os testes de integração iniciam vários processos Git, mais lentos nos runners Windows.
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
});
