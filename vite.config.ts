import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    plugins: [react()],
    esbuild: isProduction
      ? {
          // strip chatter but keep console.warn/error — they carry the
          // diagnostics (dead audio, crash reports) worth having in prod
          drop: ["debugger"],
          pure: ["console.log", "console.info", "console.debug"],
        }
      : undefined,
    build: {
      sourcemap: false,
      minify: "esbuild",
      cssMinify: true,
    },
  };
});
