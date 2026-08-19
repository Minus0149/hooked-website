/**
 * The rules that decide what the deck is allowed to deal again.
 * Run: node --experimental-strip-types verify-replay.mjs
 *
 * This is the logic behind two complaints: songs you already saved coming back
 * round, and a song you swiped left on reappearing. Both came from the refill
 * relaxing its filters when it ran short of fresh material.
 */

// mirrors blockedIds in src/state/store.tsx
function blockedIds(state) {
  const allow = new Set(state.replayContainers);
  const blocked = new Set(state.neverTracks);
  if (!allow.has("liked")) for (const t of state.liked) blocked.add(t.id);
  if (!allow.has("discoveries")) for (const t of state.discoveries) blocked.add(t.id);
  for (const p of state.playlists) {
    if (allow.has(`pl:${p.id}`)) continue;
    for (const t of p.tracks) blocked.add(t.id);
  }
  return blocked;
}

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}\n         got      ${a}\n         expected ${e}`);
  }
};

const track = (id) => ({ id, artist: `artist-${id}` });
const base = {
  liked: [track("a")],
  discoveries: [track("b")],
  playlists: [
    { id: "p1", tracks: [track("c")] },
    { id: "p2", tracks: [track("d")] },
  ],
  neverTracks: ["z"],
  replayContainers: [],
};

console.log("\nDefault: saved songs stay out, buried songs stay out");
{
  const b = blockedIds(base);
  check("liked blocked", b.has("a"), true);
  check("discoveries blocked", b.has("b"), true);
  check("both playlists blocked", [b.has("c"), b.has("d")], [true, true]);
  check("buried song blocked", b.has("z"), true);
  check("an unrelated song is fine", b.has("fresh"), false);
}

console.log("\nOne playlist opted back in — and only that one");
{
  const b = blockedIds({ ...base, replayContainers: ["pl:p1"] });
  check("p1 can replay", b.has("c"), false);
  check("p2 still blocked", b.has("d"), true);
  check("liked still blocked", b.has("a"), true);
}

console.log("\nEverything opted in: the buried song is still buried");
{
  const b = blockedIds({
    ...base,
    replayContainers: ["liked", "discoveries", "pl:p1", "pl:p2"],
  });
  check("nothing saved is blocked", [b.has("a"), b.has("b"), b.has("c"), b.has("d")],
    [false, false, false, false]);
  check("buried song survives every toggle", b.has("z"), true);
}

console.log("\nA song in two places needs both opted in");
{
  const shared = track("s");
  const state = {
    ...base,
    liked: [shared],
    playlists: [{ id: "p1", tracks: [shared] }],
    replayContainers: ["liked"],
  };
  check("still blocked by the playlist", blockedIds(state).has("s"), true);
  check(
    "free once both allow it",
    blockedIds({ ...state, replayContainers: ["liked", "pl:p1"] }).has("s"),
    false,
  );
}

console.log(failures ? `\n${failures} FAILED` : "\nall good");
process.exit(failures ? 1 : 0);
