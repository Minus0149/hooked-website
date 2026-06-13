import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  plugins: [
    convexClient(),
    // cast: minor type-level skew between better-auth 1.6.x and the Convex
    // plugin's bundled declarations; runtime shape is identical
    crossDomainClient() as unknown as BetterAuthClientPlugin,
  ],
});
