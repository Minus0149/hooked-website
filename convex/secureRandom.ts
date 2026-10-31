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

/**
 * `length` characters drawn uniformly from `alphabet` (2 to 256 of them).
 * Bytes that would bias the pick (an alphabet that doesn't divide 256) are
 * thrown away and redrawn.
 */
export function secureCode(length: number, alphabet: string): string {
  const n = alphabet.length;
  const ceiling = 256 - (256 % n);
  let out = "";
  const buf = new Uint8Array(Math.max(16, length * 2));
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= ceiling) continue;
      out += alphabet[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}
