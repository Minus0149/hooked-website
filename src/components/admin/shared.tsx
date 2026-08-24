/** Values every admin tab needs, and nothing else. */
export const ACTION_COLOR: Record<string, string> = {
  skip: "#8E8C99",
  save: "var(--save)",
  more: "var(--more)",
  never: "var(--never)",
};

export const PERM_LABEL: Record<string, string> = {
  "stats.view": "stats",
  "users.view": "see users",
  "users.manage": "manage users",
  "catalog.curate": "curate catalog",
};

export type Tab =
  | "overview"
  | "analytics"
  | "requests"
  | "creators"
  | "users"
  | "catalog"
  | "ads"
  | "config"
  | "feed";

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
