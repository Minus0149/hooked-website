import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error - plain ESM shared with the tests
import { connectSources, CONNECT_PLACEHOLDER } from "./scripts/lib/csp.mjs";
// @ts-expect-error - plain ESM shared with the tests
import { parseEnvFile, pinnedBackend } from "./scripts/lib/backend-env.mjs";

/** Point the CSP's connect-src at whichever backend this build talks to. */
function backendCsp(connect: string): Plugin {
  let outDir = "dist";
  return {
    name: "hooked-backend-csp",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: (html) => html.replaceAll(CONNECT_PLACEHOLDER, connect),
    writeBundle() {
      const headers = resolve(outDir, "_headers");
      if (!existsSync(headers)) return;
      writeFileSync(headers, readFileSync(headers, "utf8").replaceAll(CONNECT_PLACEHOLDER, connect));
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  // A production build talks to the backend the repo names, not whatever the
  // host's build variables still say — set before Vite reads the env.
  const committed = existsSync(".env.production")
    ? parseEnvFile(readFileSync(".env.production", "utf8"))
    : {};
  Object.assign(process.env, pinnedBackend(mode, committed));
  const connect = connectSources(loadEnv(mode, process.cwd(), "VITE_"));

  return {
    plugins: [react(), backendCsp(connect)],
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
