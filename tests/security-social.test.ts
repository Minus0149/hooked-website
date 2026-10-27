import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  PLAYLIST_CODE_LENGTH,
  ROOM_CODE_LENGTH,
  inviteCodeChange,
  inviteOpen,
  makeCode,
  normalizeCode,
} from "../convex/socialRules";
import { secureRandom, secureToken } from "../convex/secureRandom";

const source = (file: string) => readFileSync(resolve(__dirname, "..", "convex", file), "utf8");

/** The body of one exported Convex function, up to the next top-level export. */
function handlerOf(file: string, name: string): string {
  const src = source(file);
  const start = src.indexOf(`export const ${name} = `);
  if (start < 0) throw new Error(`${file}: no export ${name}`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe("invite and room codes can't be guessed", () => {
  it("come from the CSPRNG, never Math.random", () => {
    for (const file of ["social.ts", "referrals.ts", "imports.ts"]) {
      expect(source(file), file).not.toMatch(/Math\.random/);
    }
    expect(handlerOf("social.ts", "setPlaylistSharing")).toMatch(/PLAYLIST_CODE_LENGTH/);
    expect(handlerOf("social.ts", "createRoom")).toMatch(/ROOM_CODE_LENGTH/);
    expect(source("social.ts")).toMatch(/makeCode\(length, secureRandom\)/);
  });

  it("are long enough that guessing one is hopeless", () => {
    // 31^8 ≈ 8.5e11: at 1,000 guesses a second that is ~27 years per code
    expect(PLAYLIST_CODE_LENGTH).toBeGreaterThanOrEqual(8);
    expect(ROOM_CODE_LENGTH).toBeGreaterThanOrEqual(8);
    expect(CODE_ALPHABET.length ** ROOM_CODE_LENGTH).toBeGreaterThan(5e11);
  });

  it("survive the trip through a URL and the join box", () => {
    const code = makeCode(ROOM_CODE_LENGTH, secureRandom);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(normalizeCode(code.toLowerCase())).toBe(code);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
  });

  it("are spread across the whole alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const c of makeCode(8, secureRandom)) seen.add(c);
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });

  it("secureRandom stays inside [0, 1) and secureToken is 144-bit hex by default", () => {
    for (let i = 0; i < 1000; i++) {
      const r = secureRandom();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
    const a = secureToken();
    expect(a).toMatch(/^[0-9a-f]{36}$/);
    expect(secureToken()).not.toBe(a);
  });
});

describe("a playlist invite only works while the playlist is shared", () => {
  it("is open for public or collaborative playlists, closed otherwise", () => {
    expect(inviteOpen({ visibility: "public" })).toBe(true);
    expect(inviteOpen({ visibility: "private", collaborative: true })).toBe(true);
    expect(inviteOpen({ visibility: "private", collaborative: false })).toBe(false);
    expect(inviteOpen({})).toBe(false);
  });

  it("is issued on the first share and revoked on un-share", () => {
    expect(inviteCodeChange({ visibility: "public" }, false)).toBe("issue");
    expect(inviteCodeChange({ collaborative: true }, true)).toBe("keep");
    expect(inviteCodeChange({ visibility: "private", collaborative: false }, true)).toBe("revoke");
    expect(inviteCodeChange({ visibility: "private", collaborative: false }, false)).toBe("keep");
  });

  it("is checked by both the join mutation and the invite preview", () => {
    expect(handlerOf("social.ts", "joinPlaylist")).toMatch(/inviteOpen\(pl\)/);
    expect(handlerOf("social.ts", "invite")).toMatch(/inviteOpen\(pl\)/);
    expect(handlerOf("social.ts", "setPlaylistSharing")).toMatch(/inviteCodeChange\(/);
  });
});

describe("rooms", () => {
  it("only take reactions from people who joined, not anyone holding the code", () => {
    const body = handlerOf("social.ts", "reactInRoom");
    expect(body).toMatch(/by_room_user/);
    expect(body).toMatch(/Join the room first/);
  });

  it("bound the client's track list before doing any work on it", () => {
    expect(handlerOf("social.ts", "createRoom")).toMatch(/trackIds\.slice\(0, ROOM_MAX_TRACKS \* 4\)/);
  });
});

describe("every social write is gated and every social read names its viewer", () => {
  const src = source("social.ts");
  const exports = [...src.matchAll(/export const (\w+) = (query|mutation)\(/g)].map((m) => ({ name: m[1], kind: m[2] }));

  it("finds the social functions", () => {
    expect(exports.length).toBeGreaterThan(20);
  });

  for (const { name, kind } of exports) {
    it(`${kind} social.${name}`, () => {
      const body = handlerOf("social.ts", name);
      if (kind === "mutation") {
        // an approved, unsuspended account: a signed-in stranger isn't enough
        expect(body).toMatch(/requireGatedUser\(ctx\)/);
      } else if (name !== "invite") {
        // invite is the join screen's preview: the unguessable code is the key
        expect(body).toMatch(/viewerId\(ctx\)/);
      }
    });
  }

  it("rate-limits the writes a spammer would reach for", () => {
    for (const name of ["follow", "shareToFollowers", "setPlaylistSharing", "joinPlaylist", "addToPlaylist", "createRoom", "joinRoom", "reactInRoom"]) {
      expect(handlerOf("social.ts", name), name).toMatch(/enforceRateLimit\(/);
    }
  });
});
