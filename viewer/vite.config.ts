import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so the build works from a GitHub Pages subpath
  base: "./",
  plugins: [react()],
});
