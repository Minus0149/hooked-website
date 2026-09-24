import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Playlist, SaveTarget, SwipeAction, Track } from "../types";
import catalogJson from "../data/catalog.json";
import { EMPTY_TASTE, genreBoostScore, tasteScore, type TastePrefs } from "../data/taste";
import { coercePrefs, DEFAULT_PREFS, type UserPrefs } from "../data/prefs";
import {
  buildQueue,
  MODEL_PLACES,
  MOOD_PLACES,
  rankPool,
  shuffle,
  keepOnScreen,
  spreadAlbums,
  uniqueById,
  type Steer,
} from "../data/ranking";
import { coerceMood, type CrowdMoods, type MoodId } from "../data/mood";
import { trainFromHistory, type TasteModel } from "../data/predict";
import { SOUND_PLACES, soundTaste, type SoundTaste } from "../data/sound";

/**
 * Songs shipped inside the bundle. They are the offline fallback and the very
 * first deck a new visitor sees — the real catalogue lives in Convex and
 * replaces this the moment tracks.list answers, which is also the only way
 * hooks, creator uploads and imports ever reach the deck.
 */
const BAKED = catalogJson as Track[];
const PERSIST_KEY = "hooked.library.v2";

/**
 * How long a picked mood outlives the session that picked it.
 *
 * Long enough that closing a tab or dropping a call doesn't silently undo what
 * someone asked for; short enough that Friday night's "party" is not still on
 * the deck at Monday breakfast. Six hours is roughly one listening occasion.
 */
const MOOD_TTL = 6 * 60 * 60 * 1000;

export interface HistoryEntry {
  track: Track;
  action: SwipeAction;
  // true only when a "save" actually added the track to the library —
  // re-liking an already-saved song must not remove it on revert
  savedToLibrary?: boolean;
}

export interface AppState {
  queue: Track[]; // queue[0] is the track on deck
  history: HistoryEntry[];
  liked: Track[];
  discoveries: Track[];
  playlists: Playlist[];
  neverArtists: string[];
  boostGenres: string[];
  saveTarget: SaveTarget;
  autoAdvance: boolean; // keep playing the next song when a preview ends
  // server-allowed track ids (admin can hide tracks); null until known —
  // refills must respect this or hidden tracks get re-dealt
  allowedIds: string[] | null;
  // every track the deck may deal, carrying its hooks. Starts as the baked
  // list and is replaced by the server's.
  catalog: Track[];
  // songs the listener buried with a left swipe; never re-dealt, ever
  neverTracks: string[];
  // containers whose songs may come round again ("liked" | "discoveries" | "pl:<id>")
  replayContainers: string[];
  // what they told us before the first card
  taste: TastePrefs;
  // how the app should look and behave (Settings → synced to the profile)
  prefs: UserPrefs;
  /**
   * The deck's memory: per track, when it was last dealt and how many times
   * it was skipped. Two skips auto-bury the song (song only — the artist is
   * untouched); anything seen in the last 7 days waits its turn. This is the
   * difference between "the deck forgot me" and "the deck knows me".
   */
  deckMemory: Record<string, { seen: number; skips: number }>;
  /**
   * What the catalogue's other listeners imply about this one: a score per
   * track from the shared neighbour model (convex/recommend.ts). Sparse by
   * design — most tracks are absent, and in a young catalogue all of them are.
   */
  affinity: Record<string, number>;
  /**
   * How far affinity may move a track, in places. Comes from the runtime
   * config, so an admin can turn the recommender down — or off — without a
   * deploy. Zero here and the deck is exactly what it was before.
   */
  affinityStrength: number;
  /**
   * The face they picked: a lens over the deck, and the only signal here about
   * *now* rather than about them. Null is the normal state.
   */
  mood: MoodId | null;
  /**
   * When it was picked. A mood is momentary — Friday night's "party" restored
   * into Monday morning would be the app confidently misreading the room — so
   * a stored lens is only honoured for a few hours.
   */
  moodSetAt: number;
  /** What THIS listener said each track feels like: trackId -> mood. */
  moodPicks: Record<string, MoodId>;
  /** What everyone else said, once enough of them agreed. Sparse. */
  crowdMoods: CrowdMoods;
  /** How far a mood may move a track, in places (runtime config). */
  moodStrength: number;
  /** How far the locally-trained model may move a track (runtime config). */
  modelStrength: number;
}

type Action =
  | { type: "SWIPE"; action: SwipeAction }
  | { type: "BACK" }
  | { type: "JUMP_TO"; trackId: string }
  | { type: "SET_SAVE_TARGET"; target: SaveTarget }
  | { type: "SET_AUTO_ADVANCE"; value: boolean }
  | { type: "SET_REPLAY"; container: string; allow: boolean }
  | { type: "UNBURY"; trackId: string }
  | { type: "UNBLOCK_ARTIST"; artist: string }
  | {
      type: "PLAYLIST_RULES";
      id: string;
      allowRepeats?: boolean;
      includeBuried?: boolean;
      includeBlockedArtists?: boolean;
    }
  | { type: "SET_PREFS"; prefs: Partial<UserPrefs> }
  | { type: "SET_TASTE"; taste: TastePrefs }
  | { type: "CREATE_PLAYLIST"; playlist: Playlist }
  | { type: "DELETE_PLAYLIST"; id: string }
  | { type: "REMOVE_SONG"; trackId: string }
  | {
      // replaces the local library with the signed-in user's cloud library
      type: "HYDRATE_REMOTE";
      liked: Track[];
      discoveries: Track[];
      playlists: Playlist[];
      neverArtists: string[];
      neverTracks: string[];
      replayContainers: string[];
      taste: TastePrefs | null;
      prefs: Partial<UserPrefs> | null;
      saveTarget: SaveTarget;
    }
  | {
      // the server catalogue arrived: it replaces the baked one wholesale,
      // which is what brings hooks and creator tracks into the deck
      type: "APPLY_CATALOG";
      tracks: Track[];
    }
  | {
      // the server scored this listener against the shared neighbour model
      type: "APPLY_AFFINITY";
      scores: Record<string, number>;
      strength: number;
    }
  // a face was pressed: on the deck (trackId set) it also labels that song
  | { type: "SET_MOOD"; mood: MoodId | null; trackId?: string }
  // the catalogue's published mood tags arrived
  | { type: "APPLY_CROWD_MOODS"; crowd: CrowdMoods }
  // this listener's own labels, from the profile rather than this device
  | { type: "APPLY_MOOD_PICKS"; picks: Record<string, MoodId> }
  // the admin's dials for the two client-side signals
  | { type: "SET_STRENGTHS"; mood: number; model: number };

/**
 * The trained model, rebuilt only when the evidence behind it changed.
 *
 * Training costs a couple of milliseconds, which is nothing once and quite a
 * lot on every swipe of a long session. The key is a signature of everything
 * buildExamples reads; anything that moves it retrains, anything that doesn't
 * reuses. (Swapping one saved track for another of the same count would fool
 * it — that can't happen without a save or a remove, both of which change a
 * length.)
 */
let modelCache: { key: string; model: TasteModel | null } | null = null;

function modelFor(state: AppState): TasteModel | null {
  const skipped = Object.keys(state.deckMemory).filter(
    (id) => state.deckMemory[id].skips > 0,
  );
  const key = [
    state.liked.length,
    state.discoveries.length,
    state.playlists.map((p) => p.tracks.length).join(","),
    state.neverTracks.length,
    skipped.length,
    state.catalog.length,
    Object.keys(state.crowdMoods).length,
  ].join("|");
  if (modelCache && modelCache.key === key) return modelCache.model;
  const model = trainFromHistory({
    saved: [
      ...state.liked,
      ...state.discoveries,
      ...state.playlists.flatMap((p) => p.tracks),
    ],
    buried: state.neverTracks,
    skipped,
    catalog: state.catalog,
    crowd: state.crowdMoods,
  });
  modelCache = { key, model };
  return model;
}

let soundCache: { key: string; taste: SoundTaste | null } | null = null;

/**
 * The listener's taste vector, from the same history the model trains on.
 * Rebuilt only when that history (or the catalogue it resolves against)
 * changes — it's a few hundred multiply-adds, but it runs on every re-rank.
 */
function soundFor(state: AppState): SoundTaste | null {
  const skipped = Object.keys(state.deckMemory).filter((id) => state.deckMemory[id].skips > 0);
  const key = [
    state.liked.length,
    state.discoveries.length,
    state.playlists.map((p) => p.tracks.length).join(","),
    state.neverTracks.length,
    skipped.length,
    state.catalog.length,
  ].join("|");
  if (soundCache && soundCache.key === key) return soundCache.taste;
  const taste = soundTaste({
    saved: [...state.liked, ...state.discoveries, ...state.playlists.flatMap((p) => p.tracks)],
    buried: state.neverTracks,
    skipped,
    catalog: state.catalog,
  });
  soundCache = { key, taste };
  return taste;
}

function steerOf(state: AppState): Steer {
  return {
    taste: state.taste,
    boostGenres: state.boostGenres,
    affinity: state.affinity,
    affinityStrength: state.affinityStrength,
    mood: state.mood,
    moodStrength: state.moodStrength,
    crowdMoods: state.crowdMoods,
    model: modelFor(state),
    modelStrength: state.modelStrength,
    sound: soundFor(state),
    soundStrength: SOUND_PLACES,
  };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<
      Pick<
        AppState,
        | "liked"
        | "discoveries"
        | "playlists"
        | "neverArtists"
        | "neverTracks"
        | "replayContainers"
        | "taste"
        | "saveTarget"
        | "boostGenres"
        | "autoAdvance"
        | "deckMemory"
        | "moodSetAt"
        | "moodPicks"
      >
    > & { prefs?: Partial<UserPrefs>; mood?: unknown };
  } catch {
    return null;
  }
}

function libraryIds(state: Pick<AppState, "liked" | "discoveries" | "playlists">) {
  return new Set(
    [
      ...state.liked,
      ...state.discoveries,
      ...state.playlists.flatMap((p) => p.tracks),
    ].map((t) => t.id),
  );
}

/**
 * Everything the deck must not deal again.
 *
 * Buried songs are absolute. Saved songs are excluded per container, because
 * "I saved this" usually means "stop showing me it" but not always — a playlist
 * someone treats as a rotation should keep coming round, and only they know
 * which of their playlists is which.
 */
function blockedIds(
  state: Pick<
    AppState,
    "liked" | "discoveries" | "playlists" | "neverTracks" | "replayContainers"
  > & { prefs?: Partial<UserPrefs> | null },
): Set<string> {
  const allow = new Set(state.replayContainers);
  // global discovery rules relax the defaults for everyone
  const prefs = (state.prefs ?? {}) as Partial<UserPrefs>;
  if (prefs.includeBuried) return allow;
  const blocked = new Set(state.neverTracks);
  if (!prefs.allowRepeats) {
    if (!allow.has("liked")) for (const t of state.liked) blocked.add(t.id);
    if (!allow.has("discoveries")) for (const t of state.discoveries) blocked.add(t.id);
  }
  for (const p of state.playlists) {
    if (allow.has(`pl:${p.id}`)) continue;
    for (const t of p.tracks) blocked.add(t.id);
  }
  return blocked;
}

function initState(): AppState {
  const saved = loadPersisted();
  const liked = uniqueById(saved?.liked ?? []);
  const discoveries = uniqueById(saved?.discoveries ?? []);
  const playlists = (saved?.playlists ?? []).map((p) => ({
    ...p,
    tracks: uniqueById(p.tracks),
  }));
  const neverArtists = saved?.neverArtists ?? [];
  const boostGenres = saved?.boostGenres ?? [];
  const inLibrary = libraryIds({ liked, discoveries, playlists });
  const taste = saved?.taste ?? EMPTY_TASTE;
  // Affinity is never persisted: it is the server's opinion of this listener,
  // it goes stale the moment the model rebuilds, and a guest has none. It
  // arrives after sign-in, or it never arrives and the deck is unchanged.
  const affinity = {};
  const affinityStrength = 0;
  // A lens survives a reload — closing a tab shouldn't undo an instruction —
  // but not a night's sleep. See MOOD_TTL.
  const moodSetAt = saved?.moodSetAt ?? 0;
  const mood =
    Date.now() - moodSetAt < MOOD_TTL ? coerceMood(saved?.mood) : null;
  const moodPicks = (saved?.moodPicks ?? {}) as Record<string, MoodId>;
  const crowdMoods = {};
  return {
    catalog: BAKED,
    affinity,
    affinityStrength,
    mood,
    moodSetAt: mood ? moodSetAt : 0,
    moodPicks,
    crowdMoods,
    moodStrength: MOOD_PLACES,
    modelStrength: MODEL_PLACES,
    neverTracks: saved?.neverTracks ?? [],
    replayContainers: saved?.replayContainers ?? [],
    taste,
    prefs: { ...DEFAULT_PREFS, ...coercePrefs(saved?.prefs) },
    queue: spreadAlbums(
      buildQueue(BAKED, inLibrary, neverArtists, {
        sound: null, // no history yet, so no taste vector
        soundStrength: SOUND_PLACES,
        taste,
        boostGenres,
        affinity,
        affinityStrength,
        mood,
        moodStrength: MOOD_PLACES,
        crowdMoods,
        // Nothing to train from on the very first render: the reducer builds
        // the model the first time it ranks with a real library behind it.
        model: null,
        modelStrength: MODEL_PLACES,
      }),
    ),
    history: [],
    liked,
    discoveries,
    playlists,
    neverArtists,
    boostGenres,
    saveTarget: saved?.saveTarget ?? "liked",
    autoAdvance: saved?.autoAdvance ?? true,
    allowedIds: null,
    deckMemory: saved?.deckMemory ?? {},
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SWIPE": {
      const current = state.queue[0];
      if (!current) return state;
      let rest = state.queue.slice(1);
      let { liked, discoveries, playlists, neverArtists, neverTracks, boostGenres } = state;

      const savedToLibrary =
        action.action === "save" && !libraryIds(state).has(current.id);
      if (savedToLibrary) {
        if (state.saveTarget === "liked") {
          liked = [current, ...liked];
        } else if (state.saveTarget === "discoveries") {
          discoveries = [current, ...discoveries];
        } else {
          const plId = state.saveTarget.slice(3);
          const found = playlists.some((p) => p.id === plId);
          if (found) {
            playlists = playlists.map((p) =>
              p.id === plId ? { ...p, tracks: [current, ...p.tracks] } : p,
            );
          } else {
            liked = [current, ...liked]; // target playlist vanished — fall back
          }
        }
      }
      if (action.action === "more") {
        // keep the visible peek card in place — re-ranking the card the user
        // can already see reads as photos jumping around
        const [peek, ...tail] = rest;
        const similar = tail.filter(
          (t) => t.genre === current.genre || t.artist === current.artist,
        );
        const others = tail.filter(
          (t) => t.genre !== current.genre && t.artist !== current.artist,
        );
        rest = peek
          ? [peek, ...shuffle(similar), ...others]
          : [...shuffle(similar), ...others];
        boostGenres = [
          current.genre,
          ...boostGenres.filter((g) => g !== current.genre),
        ].slice(0, 3);
      }
      if (action.action === "never") {
        neverArtists = neverArtists.includes(current.artist)
          ? neverArtists
          : [...neverArtists, current.artist];
        // bury the song too. The artist block is the broader promise and can be
        // lifted; "never play this one again" should survive that.
        neverTracks = neverTracks.includes(current.id)
          ? neverTracks
          : [...neverTracks, current.id];
        rest = rest.filter((t) => t.artist !== current.artist);
      }
      // top up BEFORE the queue runs dry (the deck shows 3 cards), and never
      // refill with the just-swiped track, anything already queued, or
      // recently seen songs — re-dealing the same card right back was the
      // "old image appears again" glitch (and, with ↩, duplicate queue ids)
      if (rest.length < 3) {
        // per-playlist + global discovery rules: while THIS playlist is the
        // save target, its toggles relax the deck's exclusions; the global
        // Settings toggles are the default strictness for everything else
        const targetId = state.saveTarget.startsWith("pl:")
          ? state.saveTarget.slice(3)
          : null;
        const targetPl = targetId
          ? playlists.find((p) => p.id === targetId)
          : null;
        const repeatsOk =
          state.replayContainers.includes(state.saveTarget) ||
          (targetPl?.allowRepeats ?? false) ||
          state.prefs.allowRepeats;
        const buriedOk =
          (targetPl?.includeBuried ?? false) || state.prefs.includeBuried;
        const artistsOk =
          (targetPl?.includeBlockedArtists ?? false) ||
          state.prefs.includeBlockedArtists;

        // library exclusions, honouring global replay rules and the target's
        const libraryBlock = new Set<string>();
        if (!state.replayContainers.includes("liked"))
          for (const t of liked) libraryBlock.add(t.id);
        if (!state.replayContainers.includes("discoveries"))
          for (const t of discoveries) libraryBlock.add(t.id);
        for (const p of playlists) {
          if (targetPl && p.id === targetPl.id && p.allowRepeats) continue;
          if (state.replayContainers.includes(`pl:${p.id}`)) continue;
          for (const t of p.tracks) libraryBlock.add(t.id);
        }

        const allowed = state.allowedIds ? new Set(state.allowedIds) : null;
        const avoid = new Set([
          current.id,
          ...rest.map((t) => t.id),
          ...state.history.slice(-12).map((h) => h.track.id),
        ]);
        // Refills skip admin-hidden tracks, buried songs and anything the
        // listener already keeps — unless rules say otherwise. ALSO: anything
        // dealt in the last 7 days waits its turn (deck memory); if that
        // starves the deck, recency relaxes first, never the hard filters.
        const WEEK = 7 * 86_400_000;
        const baseFilters = (t: Track) =>
          (!allowed || allowed.has(t.id)) &&
          (buriedOk || !neverTracks.includes(t.id)) &&
          (artistsOk || !neverArtists.includes(t.artist)) &&
          (repeatsOk || !libraryBlock.has(t.id));
        const seenTooRecently = (t: Track) => {
          const m = state.deckMemory[t.id];
          return m !== undefined && Date.now() - m.seen < WEEK;
        };
        let pickable = state.catalog.filter(
          (t) => baseFilters(t) && !seenTooRecently(t),
        );
        if (pickable.length < 3) {
          pickable = state.catalog.filter(baseFilters);
        }
        const fresh = pickable.filter((t) => !avoid.has(t.id));
        const pool = fresh.length >= 3 ? fresh : pickable.filter((t) => t.id !== current.id);
        // Refills honour the steer and the taste answers too — otherwise a
        // right-swipe's promise expired the moment its one reshuffle was spent
        rest = [...rest, ...rankPool(pool, { ...steerOf(state), boostGenres })];
      }
      // deck memory: every dealt card is remembered — skips count toward the
      // two-strike auto-bury (song only; the artist stays dealable)
      const mem: typeof state.deckMemory = {};
      for (const [id, m] of Object.entries(state.deckMemory)) {
        if (Date.now() - m.seen < 90 * 86_400_000) mem[id] = m; // prune >90d
      }
      const prev = mem[current.id] ?? { seen: 0, skips: 0 };
      mem[current.id] = {
        seen: Date.now(),
        skips: action.action === "skip" ? prev.skips + 1 : prev.skips,
      };
      if (
        action.action === "skip" &&
        mem[current.id].skips >= 2 &&
        !neverTracks.includes(current.id)
      ) {
        // skipped twice: that's the listener voting with their thumb. Bury the
        // SONG — it lands in the Buried list where it can be unburied.
        neverTracks = [...neverTracks, current.id];
      }

      return {
        ...state,
        queue: spreadAlbums(uniqueById(rest)),
        history: [
          ...state.history,
          { track: current, action: action.action, savedToLibrary },
        ].slice(-50),
        liked,
        discoveries,
        playlists,
        neverArtists,
        neverTracks,
        boostGenres,
        deckMemory: mem,
      };
    }

    case "BACK": {
      const last = state.history[state.history.length - 1];
      if (!last) return state;
      let { liked, discoveries, playlists, neverArtists, neverTracks } = state;
      // Going back also reverts what the swipe did, so the user can re-decide —
      // but only if that save actually added the track (a re-like of an
      // already-saved song must not strip it from the library)
      if (last.action === "save" && last.savedToLibrary) {
        liked = liked.filter((t) => t.id !== last.track.id);
        discoveries = discoveries.filter((t) => t.id !== last.track.id);
        playlists = playlists.map((p) => ({
          ...p,
          tracks: p.tracks.filter((t) => t.id !== last.track.id),
        }));
      }
      if (last.action === "never") {
        neverArtists = neverArtists.filter((a) => a !== last.track.artist);
        // un-bury the song too — a left swipe buries both, so undoing it must
        // lift both, or the ↩ button quietly lied about half its promise
        neverTracks = neverTracks.filter((id) => id !== last.track.id);
      }
      return {
        ...state,
        queue: uniqueById([last.track, ...state.queue]),
        history: state.history.slice(0, -1),
        liked,
        discoveries,
        playlists,
        neverArtists,
        neverTracks,
      };
    }

    case "CREATE_PLAYLIST":
      return { ...state, playlists: [...state.playlists, action.playlist] };

    case "DELETE_PLAYLIST": {
      const saveTarget =
        state.saveTarget === `pl:${action.id}` ? "liked" : state.saveTarget;
      return {
        ...state,
        playlists: state.playlists.filter((p) => p.id !== action.id),
        saveTarget,
      };
    }

    case "REMOVE_SONG":
      return {
        ...state,
        liked: state.liked.filter((t) => t.id !== action.trackId),
        discoveries: state.discoveries.filter((t) => t.id !== action.trackId),
        playlists: state.playlists.map((p) => ({
          ...p,
          tracks: p.tracks.filter((t) => t.id !== action.trackId),
        })),
      };

    case "SET_TASTE":
      // reshuffle immediately: answering three questions and seeing the same
      // deck would make the questions look decorative
      return {
        ...state,
        taste: action.taste,
        queue: spreadAlbums(
          buildQueue(state.catalog, blockedIds(state), state.neverArtists, {
            ...steerOf(state),
            taste: action.taste,
          }),
        ),
      };

    case "UNBURY":
      return {
        ...state,
        neverTracks: state.neverTracks.filter((id) => id !== action.trackId),
        // forgive the memory too, or the two-strike rule re-buries it
        deckMemory: {
          ...state.deckMemory,
          [action.trackId]: { seen: 0, skips: 0 },
        },
      };

    case "UNBLOCK_ARTIST":
      // lifting the block doesn't rewrite history: the buried *songs* stay
      // buried unless they're dug out individually
      return {
        ...state,
        neverArtists: state.neverArtists.filter((a) => a !== action.artist),
      };

    case "PLAYLIST_RULES": {
      const { id, ...rules } = action;
      return {
        ...state,
        playlists: state.playlists.map((p) =>
          p.id === id ? { ...p, ...rules } : p,
        ),
      };
    }

    case "SET_PREFS": {
      // merge only the keys actually present — coercePrefs fills defaults,
      // and using it here would reset every untouched setting
      const patch = Object.fromEntries(
        Object.entries(action.prefs).filter(([, v]) => v !== undefined),
      ) as Partial<UserPrefs>;
      return { ...state, prefs: { ...state.prefs, ...patch } };
    }

    case "SET_REPLAY": {
      const allow = new Set(state.replayContainers);
      if (action.allow) allow.add(action.container);
      else allow.delete(action.container);
      return { ...state, replayContainers: [...allow] };
    }

    case "SET_AUTO_ADVANCE":
      return { ...state, autoAdvance: action.value };

    case "JUMP_TO": {
      const target =
        state.queue.find((t) => t.id === action.trackId) ??
        state.catalog.find((t) => t.id === action.trackId);
      if (!target) return state;
      return {
        ...state,
        queue: uniqueById([target, ...state.queue]),
      };
    }

    case "SET_SAVE_TARGET":
      return { ...state, saveTarget: action.target };

    case "HYDRATE_REMOTE": {
      const inLibrary = blockedIds(action);
      // keep the card the user is looking at — yanking queue[0] mid-session
      // swaps the visible card/audio under their thumb
      const [head, ...restQ] = state.queue;
      let queue = [
        ...(head ? [head] : []),
        ...restQ.filter(
          (t) => !inLibrary.has(t.id) && !action.neverArtists.includes(t.artist),
        ),
      ];
      // filter-only hydration could leave the deck thin or permanently EMPTY
      // (SWIPE's refill is unreachable with an empty queue) — top it up here
      if (queue.length < 3) {
        const queued = new Set(queue.map((t) => t.id));
        const allowed = state.allowedIds ? new Set(state.allowedIds) : null;
        const pickable = state.catalog.filter((t) => !allowed || allowed.has(t.id));
        const fresh = pickable.filter(
          (t) =>
            !inLibrary.has(t.id) &&
            !action.neverArtists.includes(t.artist) &&
            !queued.has(t.id),
        );
        // the relaxed pool gives up on freshness, never on what they buried
        const fallback = pickable.filter(
          (t) =>
            !action.neverTracks.includes(t.id) &&
            !action.neverArtists.includes(t.artist) &&
            !queued.has(t.id),
        );
        queue = [...queue, ...shuffle(fresh.length >= 3 ? fresh : fallback)];
      }
      return {
        ...state,
        liked: uniqueById(action.liked),
        discoveries: uniqueById(action.discoveries),
        playlists: action.playlists.map((p) => ({ ...p, tracks: uniqueById(p.tracks) })),
        neverArtists: action.neverArtists,
        neverTracks: action.neverTracks,
        replayContainers: action.replayContainers,
        // a signed-in profile's answers win over whatever this device had
        taste: action.taste ?? state.taste,
        prefs: action.prefs ? { ...state.prefs, ...coercePrefs(action.prefs) } : state.prefs,
        saveTarget: action.saveTarget,
        queue: spreadAlbums(uniqueById(queue)),
        // keep history: clearing it killed the ↩ button at every sign-in
      };
    }

    case "APPLY_CATALOG": {
      const ids = action.tracks.map((t) => t.id);
      // Idempotent: tracks.list is reactive and re-fires on every hook counter
      // update, so returning a fresh object each time would feed the render
      // loop. Same ids in the same order means nothing to do.
      const sameIds =
        state.allowedIds !== null &&
        state.allowedIds.length === ids.length &&
        state.allowedIds.every((id, i) => id === ids[i]);
      if (sameIds) return state;

      // The card on screen stays (see keepOnScreen); everything behind it is
      // rebuilt from the new catalogue. Filtering the old queue instead would
      // empty the deck whenever the server list isn't a superset of the baked one.
      const head = state.queue[0];
      const exclude = libraryIds(state);
      if (head) exclude.add(head.id);

      const rest = buildQueue(action.tracks, exclude, state.neverArtists, steerOf(state));
      return {
        ...state,
        catalog: action.tracks,
        allowedIds: ids,
        queue: keepOnScreen(head, spreadAlbums(uniqueById(rest))),
      };
    }

    case "SET_MOOD": {
      const mood = action.mood;
      const moodPicks =
        action.trackId && mood
          ? { ...state.moodPicks, [action.trackId]: mood }
          : state.moodPicks;
      if (mood === state.mood && moodPicks === state.moodPicks) return state;

      const next = {
        ...state,
        mood,
        moodSetAt: mood ? Date.now() : 0,
        moodPicks,
      };
      // Re-rank behind the visible card, exactly like a right-swipe does. This
      // one DOES rebuild — unlike affinity arriving from the server, a face was
      // pressed on purpose a moment ago, and a deck that didn't visibly answer
      // would make the gesture look decorative.
      const [head, ...rest] = state.queue;
      if (!head) return next;
      return {
        ...next,
        queue: spreadAlbums(uniqueById([head, ...rankPool(rest, steerOf(next))])),
      };
    }

    case "APPLY_CROWD_MOODS": {
      // Same reasoning as APPLY_AFFINITY: it is the catalogue's opinion, it
      // arrives mid-session, and it is not worth rearranging the cards under
      // someone's thumb for. The next refill picks it up.
      const sameSize =
        Object.keys(state.crowdMoods).length === Object.keys(action.crowd).length;
      if (sameSize && Object.keys(action.crowd).every((id) => state.crowdMoods[id]))
        return state;
      return { ...state, crowdMoods: action.crowd };
    }

    case "APPLY_MOOD_PICKS": {
      // The device's own picks win: they were made here, possibly since the
      // query was sent, and a round trip is not a reason to forget one.
      const picks = { ...action.picks, ...state.moodPicks };
      if (Object.keys(picks).length === Object.keys(state.moodPicks).length) return state;
      return { ...state, moodPicks: picks };
    }

    case "SET_STRENGTHS":
      if (state.moodStrength === action.mood && state.modelStrength === action.model)
        return state;
      return { ...state, moodStrength: action.mood, modelStrength: action.model };

    case "APPLY_AFFINITY": {
      // Deliberately does NOT rebuild the queue. The model's opinion is worth
      // a few places, not worth the cards under someone's thumb rearranging
      // themselves mid-session — which is exactly what a live re-rank would
      // look like from the deck. It is stored, and the next refill (or a new
      // catalogue, or a change of taste) picks it up on its own.
      if (
        state.affinityStrength === action.strength &&
        sameScores(state.affinity, action.scores)
      ) {
        return state;
      }
      return { ...state, affinity: action.scores, affinityStrength: action.strength };
    }
  }
}

function sameScores(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

interface StoreValue {
  state: AppState;
  swipe: (action: SwipeAction) => void;
  back: () => void;
  jumpTo: (trackId: string) => void;
  setSaveTarget: (target: SaveTarget) => void;
  createPlaylist: (playlist: Playlist) => void;
  deletePlaylist: (id: string) => void;
  removeSong: (trackId: string) => void;
  setAutoAdvance: (value: boolean) => void;
  setReplay: (container: string, allow: boolean) => void;
  setTaste: (taste: TastePrefs) => void;
  setPrefs: (prefs: Partial<UserPrefs>) => void;
  unbury: (trackId: string) => void;
  unblockArtist: (artist: string) => void;
  updatePlaylistRules: (id: string, rules: { allowRepeats?: boolean; includeBuried?: boolean; includeBlockedArtists?: boolean }) => void;
  hydrateRemote: (payload: {
    liked: Track[];
    discoveries: Track[];
    playlists: Playlist[];
    neverArtists: string[];
    neverTracks: string[];
    replayContainers: string[];
    taste: TastePrefs | null;
    prefs: Partial<UserPrefs> | null;
    saveTarget: SaveTarget;
  }) => void;
  applyCatalog: (tracks: Track[]) => void;
  applyAffinity: (scores: Record<string, number>, strength: number) => void;
  /** Pick a face. Pass a trackId when it was pressed on a card — that labels it. */
  setMood: (mood: MoodId | null, trackId?: string) => void;
  applyCrowdMoods: (crowd: CrowdMoods) => void;
  applyMoodPicks: (picks: Record<string, MoodId>) => void;
  setStrengths: (mood: number, model: number) => void;
  /**
   * What this device has learned about this listener, or null before there is
   * anything to learn from. Exposed because the deck shows its verdict, and
   * recomputing it per screen would train the same model three times.
   */
  model: TasteModel | null;
  /** the listener's taste vector (data/sound.ts), or null before evidence */
  sound: SoundTaste | null;
  catalog: Track[];
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  useEffect(() => {
    const { liked, discoveries, playlists, neverArtists, neverTracks, replayContainers, taste, prefs, saveTarget, boostGenres, autoAdvance, mood, moodSetAt, moodPicks } = state;
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ liked, discoveries, playlists, neverArtists, neverTracks, replayContainers, taste, prefs, saveTarget, boostGenres, autoAdvance, mood, moodSetAt, moodPicks, deckMemory: state.deckMemory }),
    );
  }, [state.liked, state.discoveries, state.playlists, state.neverArtists, state.neverTracks, state.replayContainers, state.taste, state.prefs, state.saveTarget, state.boostGenres, state.autoAdvance, state.deckMemory, state.mood, state.moodSetAt, state.moodPicks]);

  // CRITICAL: actions are memoized once (dispatch is stable). They must NOT
  // be recreated per state change — effects depend on these functions, and
  // changing identities re-fire the effects, which dispatch again → an
  // infinite "Maximum update depth exceeded" render loop.
  const actions = useMemo(
    () => ({
      swipe: (action: SwipeAction) => dispatch({ type: "SWIPE", action }),
      back: () => dispatch({ type: "BACK" }),
      jumpTo: (trackId: string) => dispatch({ type: "JUMP_TO", trackId }),
      setSaveTarget: (target: SaveTarget) => dispatch({ type: "SET_SAVE_TARGET", target }),
      createPlaylist: (playlist: Playlist) => dispatch({ type: "CREATE_PLAYLIST", playlist }),
      deletePlaylist: (id: string) => dispatch({ type: "DELETE_PLAYLIST", id }),
      removeSong: (trackId: string) => dispatch({ type: "REMOVE_SONG", trackId }),
      setAutoAdvance: (value: boolean) => dispatch({ type: "SET_AUTO_ADVANCE", value }),
      setReplay: (container: string, allow: boolean) =>
        dispatch({ type: "SET_REPLAY", container, allow }),
      unbury: (trackId: string) => dispatch({ type: "UNBURY", trackId }),
      unblockArtist: (artist: string) => dispatch({ type: "UNBLOCK_ARTIST", artist }),
      updatePlaylistRules: (id: string, rules: { allowRepeats?: boolean; includeBuried?: boolean; includeBlockedArtists?: boolean }) => dispatch({ type: "PLAYLIST_RULES", id, ...rules }),
      setTaste: (taste: TastePrefs) => dispatch({ type: "SET_TASTE", taste }),
      setPrefs: (prefs: Partial<UserPrefs>) => dispatch({ type: "SET_PREFS", prefs }),
      hydrateRemote: (payload: {
        liked: Track[];
        discoveries: Track[];
        playlists: Playlist[];
        neverArtists: string[];
        neverTracks: string[];
        replayContainers: string[];
        taste: TastePrefs | null;
        prefs: Partial<UserPrefs> | null;
        saveTarget: SaveTarget;
      }) => dispatch({ type: "HYDRATE_REMOTE", ...payload }),
      applyCatalog: (tracks: Track[]) => dispatch({ type: "APPLY_CATALOG", tracks }),
      applyAffinity: (scores: Record<string, number>, strength: number) =>
        dispatch({ type: "APPLY_AFFINITY", scores, strength }),
      setMood: (mood: MoodId | null, trackId?: string) =>
        dispatch({ type: "SET_MOOD", mood, trackId }),
      applyCrowdMoods: (crowd: CrowdMoods) =>
        dispatch({ type: "APPLY_CROWD_MOODS", crowd }),
      applyMoodPicks: (picks: Record<string, MoodId>) =>
        dispatch({ type: "APPLY_MOOD_PICKS", picks }),
      setStrengths: (mood: number, model: number) =>
        dispatch({ type: "SET_STRENGTHS", mood, model }),
    }),
    [],
  );

  const value = useMemo<StoreValue>(
    () => ({
      state,
      ...actions,
      model: modelFor(state),
      sound: soundFor(state),
      catalog: state.catalog,
    }),
    [state, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
