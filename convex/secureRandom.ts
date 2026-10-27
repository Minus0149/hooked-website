/**
 * Randomness for anything a stranger must not be able to guess: playlist
 * invite links, listening-room codes, import run tokens.
 *
 * Math.random is not that. It is a fast, predictable generator, and inside a
 * Convex query or mutation it is seeded by the runtime so the function stays
 * deterministic. The platform CSPRNG (crypto.getRandomValues) is available in
 * the Convex runtime and in Node, so every code that grants access comes from
 * here. No Convex imports, so the tests run it directly.
 */

/** A uniform number in [0, 1), drawn from the CSPRNG. Drop-in for Math.random. */
export function secureRandom(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return word[0] / 0x1_0000_0000;
}

/** `bytes` random bytes as lowercase hex (so 2 × bytes characters). */
export function secureToken(bytes = 18): string {
  const buf = new Uint8Array(Math.max(8, Math.min(64, Math.floor(bytes))));
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
