import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: "web",
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100_000,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
