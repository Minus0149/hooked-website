import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { authClient } from "./lib/auth-client";
import "./styles/global.css";

// Fail loudly and early: an unset Convex URL used to surface as a deep,
// cryptic error inside the client long after boot. One check explains itself.
for (const key of ["VITE_CONVEX_URL", "VITE_CONVEX_SITE_URL"] as const) {
  const value = import.meta.env[key];
  if (!value || typeof value !== "string" || !/^https?:\/\//.test(value)) {
    throw new Error(
      `[hooked] ${key} is missing or not an http(s) URL. Copy env.example to .env.local and fill it in.`,
    );
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <App />
      </ConvexBetterAuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
