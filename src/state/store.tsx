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
import { EMPTY_TASTE, tasteScore, type TastePrefs } from "../data/taste";

/**
 * Songs shipped inside the bundle. They are the offline fallback and the very
 * first deck a new visitor sees — the real catalogue lives in Convex and
 * replaces this the moment tracks.list answers, which is also the only way
 * hooks, creator uploads and imports ever reach the deck.
 */
const BAKED = catalogJson as Track[];
const PERSIST_KEY = "hooked.library.v2";

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
}

type Action =
  | { type: "SWIPE"; action: SwipeAction }
  | { type: "BACK" }
  | { type: "JUMP_TO"; trackId: string }
  | { type: "SET_SAVE_TARGET"; target: SaveTarget }
  | { type: "SET_AUTO_ADVANCE"; value: boolean }
  | { type: "SET_REPLAY"; container: string; allow: boolean }
  | { type: "UNBURY"; trackId: string }
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
      saveTarget: SaveTarget;
    }
  | {
      // the server catalogue arrived: it replaces the baked one wholesale,
      // which is what brings hooks and creator tracks into the deck
      type: "APPLY_CATALOG";
      tracks: Track[];
    };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
      >
    >;
  } catch {
    return null;
  }
}

function buildQueue(
  catalog: Track[],
  exclude: Set<string>,
  neverArtists: string[],
  taste?: TastePrefs,
): Track[] {
  const fresh = catalog.filter(
    (t) => !exclude.has(t.id) && !neverArtists.includes(t.artist),
  );
  // If the user has heard everything, loop the catalog rather than dead-ending
  const pool = fresh.length > 4 ? fresh : catalog.filter((t) => !neverArtists.includes(t.artist));
  return taste ? tasteSort(pool, taste) : shuffle(pool);
}

/**
 * Shuffle, then let taste pull matches forward.
 *
 * Not a sort by score: that would front-load every Hindi hip-hop track in the
 * catalogue and the deck would feel like a playlist someone else made. Shuffling
 * first and biasing second keeps it unpredictable while still opening with
 * things they said they wanted.
 */
function tasteSort(tracks: Track[], taste: TastePrefs): Track[] {
  const scored = shuffle(tracks).map((t, i) => ({
    t,
    // index keeps the shuffle meaningful; score is worth a few places, not all
    key: i - tasteScore(t, taste) * 12,
  }));
  scored.sort((a, b) => a.key - b.key);
  return scored.map((s) => s.t);
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
  >,
): Set<string> {
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

/**
 * Queue invariant: every track id appears at most once. Duplicate ids break
 * React's keyed card stack ("two children with the same key") which renders
 * as duplicated/stale card images — this guard makes that impossible.
 */
function uniqueById(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/**
 * Many catalog tracks share one album's artwork. Two of those back-to-back
 * look like "the card didn't change" even when everything works — push
 * same-artwork neighbors apart. Never moves index 0 (the visible card).
 */
function spreadAlbums(tracks: Track[]): Track[] {
  const out = [...tracks];
  for (let i = 1; i < out.length; i++) {
    if (out[i].artwork === out[i - 1].artwork) {
      const j = out.findIndex((t, k) => k > i && t.artwork !== out[i - 1].artwork);
      if (j > i) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
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
  const inLibrary = libraryIds({ liked, discoveries, playlists });
  return {
    catalog: BAKED,
    neverTracks: saved?.neverTracks ?? [],
    replayContainers: saved?.replayContainers ?? [],
    taste: saved?.taste ?? EMPTY_TASTE,
    queue: spreadAlbums(buildQueue(BAKED, inLibrary, neverArtists)),
    history: [],
    liked,
    discoveries,
    playlists,
    neverArtists,
    boostGenres: saved?.boostGenres ?? [],
    saveTarget: saved?.saveTarget ?? "liked",
    autoAdvance: saved?.autoAdvance ?? true,
    allowedIds: null,
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
        const blocked = blockedIds({
          liked,
          discoveries,
          playlists,
          neverTracks,
          replayContainers: state.replayContainers,
        });
        const allowed = state.allowedIds ? new Set(state.allowedIds) : null;
        const avoid = new Set([
          current.id,
          ...rest.map((t) => t.id),
          ...state.history.slice(-12).map((h) => h.track.id),
        ]);
        // Refills skip admin-hidden tracks, buried songs and anything the
        // listener already keeps. The old fallbacks dropped that last filter
        // when fresh material ran short, which is why saved songs came back.
        // Running low is a reason to relax *recency*, never those.
        const pickable = state.catalog.filter(
          (t) =>
            (!allowed || allowed.has(t.id)) &&
            !blocked.has(t.id) &&
            !neverArtists.includes(t.artist),
        );
        const fresh = pickable.filter((t) => !avoid.has(t.id));
        const pool = fresh.length >= 3 ? fresh : pickable.filter((t) => t.id !== current.id);
        rest = [...rest, ...shuffle(pool)];
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
      };
    }

    case "BACK": {
      const last = state.history[state.history.length - 1];
      if (!last) return state;
      let { liked, discoveries, playlists, neverArtists } = state;
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
      }
      return {
        ...state,
        queue: uniqueById([last.track, ...state.queue]),
        history: state.history.slice(0, -1),
        liked,
        discoveries,
        playlists,
        neverArtists,
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
          buildQueue(
            state.catalog,
            blockedIds(state),
            state.neverArtists,
            action.taste,
          ),
        ),
      };

    case "UNBURY":
      return {
        ...state,
        neverTracks: state.neverTracks.filter((id) => id !== action.trackId),
      };

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

      // Keep the card the user is looking at if the server still carries it,
      // but rebuild everything behind it from the new catalogue. Filtering the
      // old queue instead would empty the deck whenever the server list isn't
      // a superset of the baked one.
      const head = state.queue[0];
      const allowed = new Set(ids);
      const keepHead = head && allowed.has(head.id) ? head : null;
      const exclude = libraryIds(state);
      if (keepHead) exclude.add(keepHead.id);

      const rest = buildQueue(action.tracks, exclude, state.neverArtists);
      return {
        ...state,
        catalog: action.tracks,
        allowedIds: ids,
        queue: spreadAlbums(uniqueById(keepHead ? [keepHead, ...rest] : rest)),
      };
    }
  }
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
  unbury: (trackId: string) => void;
  hydrateRemote: (payload: {
    liked: Track[];
    discoveries: Track[];
    playlists: Playlist[];
    neverArtists: string[];
    neverTracks: string[];
    replayContainers: string[];
    taste: TastePrefs | null;
    saveTarget: SaveTarget;
  }) => void;
  applyCatalog: (tracks: Track[]) => void;
  catalog: Track[];
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  useEffect(() => {
    const { liked, discoveries, playlists, neverArtists, neverTracks, replayContainers, taste, saveTarget, boostGenres, autoAdvance } = state;
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ liked, discoveries, playlists, neverArtists, neverTracks, replayContainers, taste, saveTarget, boostGenres, autoAdvance }),
    );
  }, [state.liked, state.discoveries, state.playlists, state.neverArtists, state.neverTracks, state.replayContainers, state.taste, state.saveTarget, state.boostGenres, state.autoAdvance]);

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
      setTaste: (taste: TastePrefs) => dispatch({ type: "SET_TASTE", taste }),
      hydrateRemote: (payload: {
        liked: Track[];
        discoveries: Track[];
        playlists: Playlist[];
        neverArtists: string[];
        neverTracks: string[];
        replayContainers: string[];
        taste: TastePrefs | null;
        saveTarget: SaveTarget;
      }) => dispatch({ type: "HYDRATE_REMOTE", ...payload }),
      applyCatalog: (tracks: Track[]) => dispatch({ type: "APPLY_CATALOG", tracks }),
    }),
    [],
  );

  const value = useMemo<StoreValue>(
    () => ({ state, ...actions, catalog: state.catalog }),
    [state, actions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
