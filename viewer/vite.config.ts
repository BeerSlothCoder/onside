import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  // relative base so the build works from a GitHub Pages subpath
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        // Standalone VAR-moment replay demo — see var-replay.html/src/var-replay.tsx.
        varReplay: resolve(__dirname, "var-replay.html"),
        // Admin tool to report live VAR moments by hand — see var-admin.html/src/var-admin.tsx.
        varAdmin: resolve(__dirname, "var-admin.html"),
      },
    },
  },
});
