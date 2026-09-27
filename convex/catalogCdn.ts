import { AwsClient } from "aws4fetch";

/**
 * The catalogue's copy on Cloudflare R2 (cdn.hookedcue.com).
 *
 * Every client start that finds a new version downloads the whole catalogue
 * (~1 MB). Served from Convex file storage that counts against the plan's file
 * bandwidth; R2 has no egress charge. So each rebuild also uploads its parts to
 * R2 and, once the public copy is proven readable (from the app's origin, CORS
 * included), catalog:version hands clients its address. The Convex copy stays:
 * it is what older app builds read, and every client falls back to it.
 *
 * Configured by five env vars on the deployment (R2_*). Missing any of them
 * simply means no CDN copy — nothing else changes.
 */

export type CdnConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
};

/** The origin whose CORS access proves the web app can read the copy. */
export const APP_ORIGIN = "https://app.hookedcue.com";

export function cdnConfig(env: Record<string, string | undefined>): CdnConfig | null {
  const endpoint = env.R2_ENDPOINT?.trim().replace(/\/+$/, "");
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const publicBase = env.R2_PUBLIC_BASE?.trim().replace(/\/+$/, "");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBase) return null;
  if (!/^https:\/\//.test(endpoint) || !/^https:\/\//.test(publicBase)) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicBase };
}

/** Where one part of one version lives in the bucket. */
export function cdnKey(version: number, part: number): string {
  return `catalog/v${version}/${part}.json`;
}

/** The public folder of one version; clients append `/<part>.json`. */
export function cdnBase(publicBase: string, version: number): string {
  return `${publicBase.replace(/\/+$/, "")}/catalog/v${version}`;
}

/** Keys of versions older than `keepFrom` — the current and previous versions stay. */
export function staleKeys(keys: string[], keepFrom: number): string[] {
  return keys.filter((k) => {
    const m = /^catalog\/v(\d+)\//.exec(k);
    return m !== null && Number(m[1]) < keepFrom;
  });
}

/** A readable copy for the app: served, and allowed for the app's origin. */
export function servesApp(res: { ok: boolean; headers: { get(name: string): string | null } }): boolean {
  const allow = res.headers.get("access-control-allow-origin");
  return res.ok && (allow === "*" || allow === APP_ORIGIN);
}

function client(cfg: CdnConfig) {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
}

const objectUrl = (cfg: CdnConfig, key: string) => `${cfg.endpoint}/${cfg.bucket}/${key}`;

/**
 * Upload one version's parts and check the public copy answers. Returns the
 * version's public base when clients can use it, null otherwise (never throws:
 * a CDN problem must not stop the catalogue being published).
 */
export async function uploadVersion(cfg: CdnConfig, version: number, bodies: string[]): Promise<string | null> {
  try {
    const aws = client(cfg);
    for (const [i, body] of bodies.entries()) {
      const res = await aws.fetch(objectUrl(cfg, cdnKey(version, i)), {
        method: "PUT",
        body,
        headers: {
          "content-type": "application/json; charset=utf-8",
          // a version's parts never change: a new catalogue is a new version
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
      if (!res.ok) {
        console.warn(`catalog cdn: upload of part ${i} failed (${res.status})`);
        return null;
      }
    }
    const base = cdnBase(cfg.publicBase, version);
    const probe = await fetch(`${base}/0.json`, { headers: { origin: APP_ORIGIN } });
    if (!servesApp(probe)) {
      console.warn(
        `catalog cdn: ${cfg.publicBase} isn't serving the app yet (${probe.status}, allow-origin ${probe.headers.get("access-control-allow-origin") ?? "none"})`,
      );
      return null;
    }
    return base;
  } catch (err) {
    console.warn("catalog cdn: upload failed", err);
    return null;
  }
}

/** Delete every version older than `keepFrom`. Best effort. */
export async function pruneVersions(cfg: CdnConfig, keepFrom: number): Promise<number> {
  try {
    const aws = client(cfg);
    const res = await aws.fetch(`${cfg.endpoint}/${cfg.bucket}?list-type=2&prefix=catalog/&max-keys=1000`);
    if (!res.ok) return 0;
    const keys = [...(await res.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    let deleted = 0;
    for (const key of staleKeys(keys, keepFrom)) {
      const del = await aws.fetch(objectUrl(cfg, key), { method: "DELETE" });
      if (del.ok) deleted++;
    }
    return deleted;
  } catch (err) {
    console.warn("catalog cdn: prune failed", err);
    return 0;
  }
}
