/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as admin from "../admin.js";
import type * as ads from "../ads.js";
import type * as analyzer from "../analyzer.js";
import type * as auth from "../auth.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as library from "../library.js";
import type * as matching from "../matching.js";
import type * as runtime from "../runtime.js";
import type * as security from "../security.js";
import type * as tracks from "../tracks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  admin: typeof admin;
  ads: typeof ads;
  analyzer: typeof analyzer;
  auth: typeof auth;
  creators: typeof creators;
  crons: typeof crons;
  hooks: typeof hooks;
  http: typeof http;
  imports: typeof imports;
  library: typeof library;
  matching: typeof matching;
  runtime: typeof runtime;
  security: typeof security;
  tracks: typeof tracks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
