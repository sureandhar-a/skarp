import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "webview",
  base: "./", // asset URLs relative to main.css; absolute "/x" breaks inside a webview
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../out/webview",
    emptyOutDir: true,
    rollupOptions: {
      input: "webview/main.tsx",
      output: { entryFileNames: "main.js", assetFileNames: "main[extname]" },
    },
  },
});
