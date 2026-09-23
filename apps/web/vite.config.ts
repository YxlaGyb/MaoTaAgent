import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const uiRoot = fileURLToPath(new URL("./ui/", import.meta.url));
const sharedRoot = fileURLToPath(new URL("../../../MaoTaUI", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: uiRoot,
  build: { outDir: fileURLToPath(new URL("./dist/", import.meta.url)), emptyOutDir: true },
  resolve: { dedupe: ["react", "react-dom"] },
  server: { fs: { allow: [repoRoot, webRoot, sharedRoot] } },
});
