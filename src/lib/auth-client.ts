import { createAuthClient } from "better-auth/react";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  plugins: [
    convexClient(),
    // no cast: with better-auth and @convex-dev/better-auth on matching
    // versions the plugin types line up, and the old `as unknown as` erased
    // the session's type to `never` once they moved
    crossDomainClient(),
  ],
});
