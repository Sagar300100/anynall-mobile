// src/lib/shows-cache.ts — the module-level shows-catalog cache.
//
// Split out of hooks/use-shows so lib/shows can INVALIDATE it after seller
// mutations (createShow / updateShow / deleteShow) without a lib → hooks
// import — hooks may depend on lib, never the reverse. Before this existed,
// the 60s TTL masked a seller's own mutation: schedule, edit or cancel a
// show, land back on a list screen inside the TTL, and the stale catalog
// still showed the old state with no way to force a refetch short of
// pull-to-refresh.
import type { ShowData } from './api';

/** How long one fetched catalog serves every useShows() mount. */
const SHOWS_TTL_MS = 60_000;

let cachedShows: ShowData[] | null = null;
let cachedAt = 0;

/** The cached catalog with its fetch stamp, or null when empty or stale. */
export function readShowsCache(): { shows: ShowData[]; fetchedAt: number } | null {
  if (cachedShows !== null && Date.now() - cachedAt < SHOWS_TTL_MS) {
    return { shows: cachedShows, fetchedAt: cachedAt };
  }
  return null;
}

/** Store a freshly fetched catalog. Returns the stamp it was cached at, so
 *  callers can keep their "fetched at" clock in step with the cache's. */
export function writeShowsCache(shows: ShowData[]): number {
  cachedShows = shows;
  cachedAt = Date.now();
  return cachedAt;
}

/** Drop the cache so the next mount refetches. Called by every seller
 *  mutation in lib/shows — a seller's own change must be visible on the very
 *  next list mount, never masked for up to the TTL. */
export function invalidateShowsCache(): void {
  cachedShows = null;
  cachedAt = 0;
}
