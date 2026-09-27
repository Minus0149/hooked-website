import { describe, expect, it } from "vitest";
import {
  inSession,
  pendingSession,
  sessionOrder,
  sessionPosition,
  sessionQueue,
  withoutSession,
  type PlaySession,
} from "../src/lib/playSession";
import { exportFileName, playlistCsv, playlistText } from "../src/lib/playlistExport";

/**
 * Playing Liked Songs / Discoveries / a playlist through the deck. The rules
 * that matter: the tapped song plays first, shuffle really shuffles, the
 * session's songs sit in front of the deck without duplicates, and leaving
 * gives the deck back.
 */
const tr = (id: string) => ({ id });
const songs = ["a", "b", "c", "d", "e"].map(tr);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("sessionOrder", () => {
  it("plays in order, from the tapped song, wrapping round", () => {
    expect(ids(sessionOrder(songs, false))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(sessionOrder(songs, false, "c"))).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("shuffles every song exactly once, tapped song first", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = ids(sessionOrder(songs, true, "d", rand));
    expect(out[0]).toBe("d");
    expect([...out].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops duplicates a library might carry", () => {
    expect(ids(sessionOrder([tr("a"), tr("a"), tr("b")], false))).toEqual(["a", "b"]);
  });
});

describe("the session in the queue", () => {
  const session: PlaySession = { container: "liked", title: "Liked Songs", ids: ["a", "b", "c"] };

  it("puts the session in front of the deck without repeating a song", () => {
    const q = sessionQueue(["a", "b", "c"].map(tr), ["x", "b", "y"].map(tr));
    expect(ids(q)).toEqual(["a", "b", "c", "x", "y"]);
  });

  it("knows where it is and when it has ended", () => {
    expect(sessionPosition(session, "b")).toEqual({ index: 2, total: 3 });
    expect(sessionPosition(session, "x")).toBeNull();
    expect(inSession(session, "c")).toBe(true);
    expect(inSession(null, "c")).toBe(false);
  });

  it("keeps the unplayed songs in front and gives the deck back on leaving", () => {
    const q = ["b", "c", "x", "y"].map(tr);
    expect(ids(pendingSession(q, session))).toEqual(["b", "c"]);
    expect(ids(withoutSession(q, session))).toEqual(["x", "y"]);
  });
});

describe("playlist export", () => {
  const list = [
    { title: "Kill Bill", artist: "SZA", album: "SOS" },
    { title: 'Say "Yes", Now', artist: "A, B & C" },
  ];

  it("writes one Title - Artist line per song", () => {
    expect(playlistText(list)).toBe('Kill Bill - SZA\nSay "Yes", Now - A, B & C');
  });

  it("quotes CSV cells so commas and quotes survive", () => {
    expect(playlistCsv(list)).toBe(
      'Title,Artist,Album\r\nKill Bill,SZA,SOS\r\n"Say ""Yes"", Now","A, B & C",\r\n',
    );
  });

  it("makes a safe file name, Hindi titles included", () => {
    expect(exportFileName("Liked Songs")).toBe("hookedcue-liked-songs.csv");
    expect(exportFileName("पसंदीदा गाने")).toMatch(/^hookedcue-.+\.csv$/);
    expect(exportFileName("!!!")).toBe("hookedcue-playlist.csv");
  });
});
