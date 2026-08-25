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
  "ads.manage",
  "config.manage",
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
    /**
     * Containers whose songs are allowed back into the deck: "liked",
     * "discoveries" or "pl:<id>". Saving something normally takes it out of
     * rotation — you already have it — but a playlist someone treats as a
     * rotation rather than an archive should keep coming round, and only they
     * know which is which.
     */
    replayContainers: v.optional(v.array(v.string())),
    /**
     * What they answered before the first card: languages, genre buckets and
     * how far off the charts they want taking. Tilts the deck, never filters
     * it — see tasteScore in src/data/taste.ts.
     */
    taste: v.optional(
      v.object({
        languages: v.array(v.string()),
        genres: v.array(v.string()),
        adventure: v.string(),
      }),
    ),
    /**
     * How the app should look and behave, edited in Settings and synced across
     * devices. Mirrors the client's UserPrefs shape (src/data/prefs.ts);
     * unknown keys are dropped by cleanPrefs rather than trusted.
     */
    prefs: v.optional(
      v.object({
        motion: v.string(),
        haptics: v.string(),
        accentMode: v.string(),
        accentColor: v.string(),
        swipeSensitivity: v.number(),
        /** the listener asked to stop seeing house ads */
        adsOptOut: v.boolean(),
        /** listener's own ad dial — can only space cards further apart */
        adFrequency: v.string(),
        /** global discovery rules (per-playlist rules layer on top) */
        allowRepeats: v.boolean(),
        includeBuried: v.boolean(),
        includeBlockedArtists: v.boolean(),
      }),
    ),
  }).index("by_userId", ["userId"]),

  playlists: defineTable({
    userId: v.string(),
    name: v.string(),
    accent: v.string(),
    /**
     * Per-playlist discovery rules. While this playlist is the swipe-down
     * target, its rules decide what the deck may deal:
     *   allowRepeats         — songs already in this playlist can come round
     *   includeBuried        — songs buried with a left swipe become dealable
     *   includeBlockedArtists — blocked artists become dealable
     * All default to false: the deck stays as strict as the global rules.
     */
    allowRepeats: v.optional(v.boolean()),
    includeBuried: v.optional(v.boolean()),
    includeBlockedArtists: v.optional(v.boolean()),
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

  /**
   * Songs a listener has personally buried.
   *
   * Blocking the artist was never quite the same promise: "never play this
   * again" is about the song, and a listener can dislike one track by someone
   * they otherwise want more of. Nothing re-deals a track listed here, not even
   * the fallback the deck reaches for when it runs low on fresh material.
   */
  neverTracks: defineTable({
    userId: v.string(),
    trackId: v.string(),
  }).index("by_user_track", ["userId", "trackId"]),

  tracks: defineTable({
    ...trackFields,
    hidden: v.optional(v.boolean()),
    // set when an artist owns this track rather than it being curated/imported
    ownerUserId: v.optional(v.string()),
    // full audio, uploaded by the rights holder. This is the only source that
    // supports several hooks per song — an iTunes/Deezer preview is a single
    // ~30s window, so there is nothing else to cut from.
    audioStorageId: v.optional(v.id("_storage")),
    audioDurationMs: v.optional(v.number()),
    origin: v.optional(
      v.union(v.literal("curated"), v.literal("artist"), v.literal("import")),
    ),
    /**
     * iTunes storefronts this track charted in. The only language signal the
     * chart feeds carry — Apple files a whole Bollywood chart under
     * "worldwide", so genre cannot stand in for it.
     */
    markets: v.optional(v.array(v.string())),
    /**
     * How played this track is, normalised 0..1 against the catalogue's
     * leader. Written by the hourly heat job (see hooks.computeHeat), never by
     * a swipe, so the catalogue query stays cheap and cacheable. This is what
     * makes the onboarding "the hits / take me deep" answer do anything.
     */
    heat: v.optional(v.number()),
    /**
     * When the external analyzer last measured this track's audio and wrote
     * real hooks (see scripts/analyze-hooks.mjs). Absent means "still waiting
     * for analysis" — the even-spaced provisional windows cover until then.
     */
    analyzedAt: v.optional(v.string()),
    /**
     * When the uploader confirmed they hold the rights to this recording.
     * Publishing is gated on it; the copyright policy explains what we do
     * when a rights holder disagrees (36-hour takedown target).
     */
    rightsConfirmedAt: v.optional(v.string()),
  })
    .index("by_trackId", ["trackId"])
    .index("by_owner", ["ownerUserId"]),

  // ------------------------------------------------------------------ ads
  //
  // First-party house ads only: no SDKs, no third-party tags, no bidding.
  // A card between swipes that the admin writes themselves.

  ads: defineTable({
    advertiser: v.string(), // shown as "Sponsored by …"
    title: v.string(),
    body: v.optional(v.string()),
    ctaLabel: v.string(),
    /** https-only destination; validated on write */
    ctaUrl: v.string(),
    /** optional artwork uploaded through Convex file storage */
    imageStorageId: v.optional(v.id("_storage")),
    accent: v.optional(v.string()),
    /** weighted pick among live ads; 1 is the default share */
    weight: v.number(),
    status: v.union(v.literal("draft"), v.literal("live"), v.literal("retired")),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_status", ["status"]),

  /**
   * One row per impression/click/skip. Frequency caps are computed from these,
   * so they're indexed for "what did THIS user see TODAY" and swept after 45
   * days — an ad log is not a memory-keeping exercise, and the VPS notices.
   */
  adEvents: defineTable({
    /** signed-in listener; absent for anonymous ones */
    userId: v.optional(v.string()),
    /** stable random id for anonymous listeners (localStorage/AsyncStorage) */
    anonKey: v.optional(v.string()),
    adId: v.id("ads"),
    kind: v.union(v.literal("impression"), v.literal("click"), v.literal("skip")),
    day: v.string(), // YYYY-MM-DD in UTC
    at: v.number(),
  })
    .index("by_user_day", ["userId", "day"])
    .index("by_anon_day", ["anonKey", "day"])
    .index("by_adId", ["adId"]),

  // ------------------------------------------------------------- settings

  /** Small typed key/value store for server-side configuration. */
  appSettings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  /**
   * Pre-aggregated daily counters. The admin dashboard reads THESE instead of
   * scanning every swipe ever written — analytics used to be a reactive query
   * over whole tables, which is a performance cliff wearing a graph's clothes.
   */
  statsDaily: defineTable({
    day: v.string(), // YYYY-MM-DD in UTC
    saves: v.number(),
    skips: v.number(),
    nevers: v.number(),
    mores: v.number(),
    signups: v.number(),
    requests: v.number(),
    imports: v.number(),
  }).index("by_day", ["day"]),

  // -------------------------------------------------------- fingerprints

  /**
   * Inverted index for duplicate detection: one row per (landmark-pair hash,
   * track). Computed entirely in the creator's browser (see
   * web/src/lib/audio-fp.ts) — the VPS never decodes audio, it just counts
   * hash collisions. ~200 rows per track; a thousand-track catalogue is a
   * couple hundred thousand tiny rows that are only ever read via by_hash.
   */
  fingerprints: defineTable({
    hash: v.number(), // uint32 landmark-pair hash
    trackId: v.string(),
  })
    .index("by_hash", ["hash"])
    .index("by_trackId", ["trackId"]),

  /**
   * A hook is a window into a track's audio. Imported tracks get exactly one
   * (the whole preview); uploaded tracks can have several, so the same song gets
   * more than one shot at landing.
   */
  hooks: defineTable({
    trackId: v.string(),
    startMs: v.number(),
    durationMs: v.number(),
    label: v.optional(v.string()),
    order: v.number(),
    active: v.boolean(),
    createdBy: v.string(),
    source: v.union(v.literal("curated"), v.literal("artist")),
    // Where this hook currently sits in the running order, recomputed on a
    // schedule from hookStats. It lives here rather than being derived at read
    // time so that tracks.list depends only on rows that almost never change.
    rank: v.optional(v.number()),
  })
    .index("by_trackId", ["trackId"])
    .index("by_active", ["active"]),

  /**
   * Play counters, deliberately kept out of `hooks`.
   *
   * Every swipe credits the hook that was on screen. While those counters sat
   * on the hook row itself, one person swiping rewrote a row that tracks.list
   * reads — which invalidated the whole catalogue query for every connected
   * client, who then re-read every track and every hook. At 118 songs that was
   * survivable; at a thousand it is thousands of documents re-read per swipe.
   *
   * Splitting them means hook rows stay still, tracks.list stays cached, and
   * the write cost of a swipe is one small document.
   */
  hookStats: defineTable({
    hookId: v.id("hooks"),
    trackId: v.string(),
    plays: v.number(),
    saves: v.number(),
    skips: v.number(),
  })
    .index("by_hookId", ["hookId"])
    .index("by_trackId", ["trackId"]),

  /** Artists who want to publish their own music. Approved by an admin. */
  creators: defineTable({
    userId: v.string(),
    email: v.string(),
    artistName: v.string(),
    bio: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    appliedAt: v.string(),
    decidedAt: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  /** A playlist import run, so a half-finished match can be resumed or audited. */
  imports: defineTable({
    userId: v.string(),
    source: v.union(
      v.literal("spotify"),
      v.literal("apple"),
      v.literal("itunes"),
      v.literal("manual"),
    ),
    playlistName: v.string(),
    status: v.union(
      v.literal("matching"),
      v.literal("done"),
      v.literal("failed"),
    ),
    total: v.number(),
    matched: v.number(),
    createdAt: v.string(),
    note: v.optional(v.string()),
    // Handed out when the run opens and required to write to it. The matching
    // step runs in an action, which reaches the outside world and so cannot
    // rely on the caller's identity travelling with it — this is what proves
    // the writes belong to the run that was authorised. Cleared on completion.
    token: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

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
