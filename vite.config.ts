import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    plugins: [react()],
    esbuild: isProduction
      ? {
          drop: ["console", "debugger"],
        }
      : undefined,
    build: {
      sourcemap: false,
      minify: "esbuild",
      cssMinify: true,
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
  };
});
