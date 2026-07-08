import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

// Pass 1: popup (html entry) + background service worker (ES modules are fine
// for both). The content script is built separately as a single IIFE file by
// vite.content.config.ts because MV3 content scripts cannot import chunks.
export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { Buffer: true, process: true } })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "es",
      },
    },
  },
  publicDir: "public",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
