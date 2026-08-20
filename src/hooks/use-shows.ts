import { useCallback, useEffect, useState } from 'react';

import type { ShowData } from '@/lib/api';
import { fsFetchShows } from '@/lib/shows';
import { readShowsCache, writeShowsCache } from '@/lib/shows-cache';

// ── Module-level cache, shared across every hook instance ──────────────────
//
// Every room entry used to re-fetch the 60-show catalog: the Live tab, the
// show detail screen and the live room each call useShows(), so one buyer
// hopping between rooms cost a full collection page per mount. With the
// cache, N mounts inside the TTL cost ONE Firestore fetch — and a warm mount
// paints its header from the cache immediately instead of after a round trip.
// Pull-to-refresh (refresh()) always bypasses it.
//
// The cache STORE itself lives in lib/shows-cache (not here) so that
// lib/shows can invalidate it after seller mutations — lib must never import
// from hooks. This module keeps only the fetch sharing.

/** Concurrent mounts share one in-flight fetch instead of racing their own. */
let inflight: Promise<ShowData[]> | null = null;

function fetchShared(): Promise<ShowData[]> {
  // A fetch that landed between this instance's render and its effect still
  // counts — never pay for the same minute twice.
  const hit = readShowsCache();
  if (hit) return Promise.resolve(hit.shows);
  if (!inflight) {
    inflight = fsFetchShows()
      .then((data) => {
        writeShowsCache(data);
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useShows() {
  // Seed from the cache when it is still fresh. The initializer runs once per
  // mount, so this Date.now() read cannot make re-renders unstable — the
  // purity rule below is about values read during EVERY render.
  const [seed] = useState(() => readShowsCache());
  const [shows, setShows] = useState<ShowData[]>(seed ? seed.shows : []);
  const [loading, setLoading] = useState(!seed);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Clock snapshot taken when data actually arrives — consumers use it for
  // "starts in Xm" maths so relative labels stay in step with the data and
  // no component reads Date.now() during render (React Compiler purity).
  const [fetchedAt, setFetchedAt] = useState(seed ? seed.fetchedAt : 0);

  // Initial load: `loading` starts true, so every setState here happens after
  // the await (async callback), never synchronously inside the effect body.
  // A cache-seeded mount already has its data and skips the fetch entirely.
  useEffect(() => {
    if (seed) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchShared();
        if (cancelled) return;
        setShows(data);
        // The cache stamp is the honest arrival time; Date.now() only covers
        // the sliver where an invalidation raced this continuation.
        setFetchedAt(readShowsCache()?.fetchedAt ?? Date.now());
      } catch {
        if (!cancelled) setError("Couldn't load shows. Pull to retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `seed` is set once at mount and never changes.
  }, [seed]);

  // Pull-to-refresh — user-invoked, so the synchronous spinner flip is fine.
  // Deliberately bypasses the cache (and refills it for everyone else).
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await fsFetchShows();
      const stamp = writeShowsCache(data);
      setShows(data);
      setFetchedAt(stamp);
    } catch {
      setError("Couldn't load shows. Pull to retry.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const live = shows.filter((s) => s.isLive);
  const upcoming = shows
    .filter((s) => !s.isLive && !s.replayUrl)
    .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
  const replays = shows.filter((s) => !s.isLive && !!s.replayUrl);

  return {
    shows,
    live,
    upcoming,
    replays,
    loading,
    refreshing,
    error,
    fetchedAt,
    refresh,
  };
}
