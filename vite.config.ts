import { defineConfig } from "vite";

export default defineConfig({
  root: "src/mainview",
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
