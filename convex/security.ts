import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { PERMISSIONS, trackFields } from "./schema";

const trackValidator = v.object(trackFields);

export type TrackInput = Infer<typeof trackValidator>;
export type Permission = (typeof PERMISSIONS)[number];

const DEFAULT_ACCENT = "#ff3d71";

type Profile = {
  _id: Id<"profiles">;
  userId: string;
  email: string;
  isAdmin: boolean;
  permissions?: string[];
  suspended?: boolean;
};

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx);
  if (!user) throw new Error("Not signed in");
  return { id: String(user._id), email: user.email, name: user.name };
}

export async function getProfile(ctx: QueryCtx | MutationCtx, userId: string) {
  return ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

export function hasPermission(profile: Profile | null, permission: Permission) {
  if (!profile) return false;
  return profile.isAdmin || (profile.permissions ?? []).includes(permission);
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  permission: Permission,
) {
  const user = await requireUser(ctx);
  const profile = await getProfile(ctx, user.id);
  if (!hasPermission(profile, permission)) throw new Error(`Requires ${permission}`);
  return { user, profile };
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  const profile = await getProfile(ctx, user.id);
  if (!profile?.isAdmin) throw new Error("Admin only");
  return { user, profile };
}

export function ensureActiveProfile(
  profile: { suspended?: boolean } | null,
) {
  if (profile?.suspended) throw new Error("Account suspended");
}

export async function enforceRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const safeKey = cleanText(key, 180);
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", safeKey))
    .unique();

  if (!existing || now - existing.windowStart >= windowMs) {
    if (existing) {
      await ctx.db.patch(existing._id, { count: 1, windowStart: now });
    } else {
      await ctx.db.insert("rateLimits", {
        key: safeKey,
        count: 1,
        windowStart: now,
      });
    }
    return;
  }

  if (existing.count >= limit) {
    throw new Error("Too many requests. Try again in a moment.");
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

export function cleanText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

export function cleanAccent(value: string) {
  const accent = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT;
}

function cleanHttpsUrl(value: string, maxLength: number, field: string) {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  return url.toString();
}

export function cleanTrack(track: TrackInput): TrackInput {
  const durationMs = Math.floor(track.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 30 * 60 * 1000) {
    throw new Error("Invalid track duration");
  }

  return {
    trackId: cleanText(track.trackId, 120),
    title: cleanText(track.title, 160),
    artist: cleanText(track.artist, 160),
    album: cleanText(track.album, 160),
    artwork: cleanHttpsUrl(track.artwork, 700, "Artwork URL"),
    previewUrl: cleanHttpsUrl(track.previewUrl, 900, "Preview URL"),
    durationMs,
    genre: cleanText(track.genre, 80),
    accent: cleanAccent(track.accent),
  };
}

export async function validateSaveTarget(
  ctx: MutationCtx,
  userId: string,
  target: string,
) {
  if (target === "liked" || target === "discoveries") return target;
  if (!target.startsWith("pl:")) throw new Error("Invalid save target");

  const playlistId = ctx.db.normalizeId("playlists", target.slice(3));
  if (!playlistId) throw new Error("Invalid playlist");

  const playlist = await ctx.db.get(playlistId);
  if (!playlist || playlist.userId !== userId) throw new Error("Invalid playlist");
  return `pl:${playlistId}` as const;
}
