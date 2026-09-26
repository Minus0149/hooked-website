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
import type * as applyOrigin from "../applyOrigin.js";
import type * as auth from "../auth.js";
import type * as charts from "../charts.js";
import type * as collab from "../collab.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailConfig from "../emailConfig.js";
import type * as emailTemplate from "../emailTemplate.js";
import type * as errors from "../errors.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as library from "../library.js";
import type * as matching from "../matching.js";
import type * as moods from "../moods.js";
import type * as recommend from "../recommend.js";
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
  applyOrigin: typeof applyOrigin;
  auth: typeof auth;
  charts: typeof charts;
  collab: typeof collab;
  creators: typeof creators;
  crons: typeof crons;
  email: typeof email;
  emailConfig: typeof emailConfig;
  emailTemplate: typeof emailTemplate;
  errors: typeof errors;
  hooks: typeof hooks;
  http: typeof http;
  imports: typeof imports;
  library: typeof library;
  matching: typeof matching;
  moods: typeof moods;
  recommend: typeof recommend;
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
