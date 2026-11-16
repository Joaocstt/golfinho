import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // pluginHost: processo separado que roda o worker de cada plugin (veja src/main/plugins/host.ts).
    build: { rollupOptions: { input: { index: "src/main/index.ts", pluginHost: "src/main/plugins/host.ts" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [
      react(),
      {
        name: "golfinho-development-csp",
        transformIndexHtml(html, context) {
          return context.server
            ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            : html;
        },
      },
    ],
  },
});
