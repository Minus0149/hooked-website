import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  catalogAction,
  fetchCatalog,
  joinParts,
  type CatalogTrack,
  type CatalogVersion,
} from "./catalogCodec";

/**
 * The catalogue, without the websocket.
 *
 * Watches catalog:version (a number and a part count) and downloads the
 * catalogue's parts over plain HTTP only when that version isn't already in
 * IndexedDB. A warm start therefore applies the cached catalogue before the
 * websocket has even connected, and downloads nothing. See docs/CATALOG.md.
 *
 * IndexedDB rather than localStorage: the catalogue is ~1.3 MB and growing,
 * and localStorage's ~5 MB per origin is shared with the saved library. If
 * IndexedDB is unavailable (some private windows), the catalogue is simply
 * fetched each start — nothing breaks.
 */

const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL as string;
const DB = "hookedcue-catalog";
const STORE = "kv";
const KEY = "current";

type Cached = { version: number; docs: unknown[] };

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCache(): Promise<Cached | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as Cached | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCache(value: Cached): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Calls onCatalog with the full catalogue: from cache at once, then again whenever a new version lands. */
export function useCatalog(onCatalog: (tracks: CatalogTrack[]) => void): void {
  const ver = useQuery(api.catalog.version) as CatalogVersion | undefined;
  const have = useRef<number | null>(null); // version currently applied
  const loaded = useRef(false); // cache has been read (hit or miss)
  const busy = useRef<number | null>(null); // version being downloaded
  const onCatalogRef = useRef(onCatalog);
  useEffect(() => {
    onCatalogRef.current = onCatalog;
  }, [onCatalog]);

  // warm start: the cached catalogue, before anything else answers
  useEffect(() => {
    let live = true;
    void readCache().then((cached) => {
      if (!live) return;
      loaded.current = true;
      const joined = cached ? joinParts(cached.docs) : null;
      if (joined && have.current === null) {
        have.current = joined.version;
        onCatalogRef.current(joined.tracks);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const v = ver?.v;
  const parts = ver?.parts;
  useEffect(() => {
    if (v === undefined || parts === undefined || !SITE_URL) return;
    const run = async () => {
      // don't race the cache read: a cached copy of this very version means no download
      if (!loaded.current) {
        const cached = await readCache();
        loaded.current = true;
        const joined = cached ? joinParts(cached.docs) : null;
        if (joined && have.current === null) {
          have.current = joined.version;
          onCatalogRef.current(joined.tracks);
        }
      }
      if (catalogAction(have.current, v) !== "fetch" || busy.current === v) return;
      busy.current = v;
      try {
        const got = await fetchCatalog(SITE_URL, { v, parts }, (url, init) => fetch(url, init));
        // the version decides, not timing: an older download finishing late
        // must never replace a newer catalogue
        if (have.current !== null && got.version <= have.current) return;
        have.current = got.version;
        onCatalogRef.current(got.tracks);
        void writeCache({ version: got.version, docs: got.docs });
      } catch {
        // keep dealing what we have; the next version change (or next start) tries again
      } finally {
        if (busy.current === v) busy.current = null;
      }
    };
    void run();
  }, [v, parts]);
}
