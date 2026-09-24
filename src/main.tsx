import { StrictMode, type ComponentProps } from "react";
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
    {/* outer boundary: catches provider-level crashes (no reporting — the
        convex client itself is what died) */}
    <AppErrorBoundary>
      {/* cast at this one boundary: the adapter declares the prop's session as
          `never`, which no real client satisfies; the app's own session types
          stay intact everywhere else */}
      <ConvexBetterAuthProvider
        client={convex}
        authClient={authClient as unknown as ComponentProps<typeof ConvexBetterAuthProvider>["authClient"]}
      >
        {/* inner boundary: the app's crashes get the full report panel */}
        <AppErrorBoundary reportable>
          <App />
        </AppErrorBoundary>
      </ConvexBetterAuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
);

// offline support: the SW caches the shell after first visit and serves a
// real offline page when the network is gone. Dev skips it — caching HMR
// output is a special kind of pain.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
