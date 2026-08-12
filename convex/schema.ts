import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const trackFields = {
  trackId: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.string(),
  artwork: v.string(),
  previewUrl: v.string(),
  durationMs: v.number(),
  genre: v.string(),
  accent: v.string(),
};

export const swipeAction = v.union(
  v.literal("skip"),
  v.literal("save"),
  v.literal("more"),
  v.literal("never"),
);

// "liked" | "discoveries" | "pl:<playlistId>"
export const saveTarget = v.string();

export const libraryKind = v.union(
  v.literal("liked"),
  v.literal("discoveries"),
  v.literal("playlist"),
);

/** Fine-grained dashboard permissions. Admins implicitly hold all of them. */
export const PERMISSIONS = [
  "stats.view",
  "users.view",
  "users.manage",
  "catalog.curate",
] as const;

export default defineSchema({
  profiles: defineTable({
    userId: v.string(), // Better Auth user id
    email: v.string(),
    name: v.optional(v.string()),
    isAdmin: v.boolean(),
    permissions: v.optional(v.array(v.string())),
    suspended: v.optional(v.boolean()), // suspended users can't write swipes
    saveTarget,
  }).index("by_userId", ["userId"]),

  playlists: defineTable({
    userId: v.string(),
    name: v.string(),
    accent: v.string(),
  }).index("by_user", ["userId"]),

  swipes: defineTable({
    userId: v.string(),
    action: swipeAction,
    trackId: v.string(),
    title: v.string(),
    artist: v.string(),
    genre: v.string(),
    artwork: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_user_track", ["userId", "trackId"]),

  librarySongs: defineTable({
    userId: v.string(),
    kind: libraryKind,
    playlistId: v.optional(v.id("playlists")),
    ...trackFields,
  })
    .index("by_user_kind", ["userId", "kind"])
    .index("by_user_track", ["userId", "trackId"])
    .index("by_playlist", ["playlistId"]),

  neverArtists: defineTable({
    userId: v.string(),
    artist: v.string(),
  }).index("by_user_artist", ["userId", "artist"]),

  tracks: defineTable({
    ...trackFields,
    hidden: v.optional(v.boolean()),
  }).index("by_trackId", ["trackId"]),

  // Every request for access, from either surface: the landing site's beta form
  // ("landing") and the in-app wall after the free swipes run out ("app").
  // One table on purpose — the admin reviews a single queue, and approval here
  // is what lets an account be created at all (see library.ensureProfile).
  accessRequests: defineTable({
    email: v.string(),
    name: v.string(),
    source: v.union(v.literal("app"), v.literal("landing")),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    // what they told us — all optional, the app form asks for far less than the landing one
    device: v.optional(v.string()),
    androidVersion: v.optional(v.string()),
    listensOn: v.optional(v.array(v.string())),
    genres: v.optional(v.array(v.string())),
    hours: v.optional(v.string()),
    lastSkipped: v.optional(v.string()),
    notes: v.optional(v.string()),
    // trail
    submittedAt: v.string(),
    userAgent: v.optional(v.string()),
    decidedAt: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    invited: v.optional(v.boolean()),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_source", ["source"]),

  rateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    windowStart: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_windowStart", ["windowStart"]),
});
