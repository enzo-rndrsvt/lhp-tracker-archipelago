import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any folder or sub-path (GitHub Pages, etc.)
  base: "./",
  build: { chunkSizeWarningLimit: 1500 },
});
