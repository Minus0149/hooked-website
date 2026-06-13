import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // never ship readable source: no source maps, aggressive minification
    sourcemap: false,
    minify: "esbuild",
  },
  server: {
    proxy: {
      // iTunes Search API has no CORS headers; proxy it in dev for live search
      "/itunes": {
        target: "https://itunes.apple.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/itunes/, ""),
      },
    },
  },
});
