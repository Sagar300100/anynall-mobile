import { useCallback, useEffect, useState } from 'react';

import type { ShowData } from '@/lib/api';
import { fsFetchShows } from '@/lib/shows';

export function useShows() {
  const [shows, setShows] = useState<ShowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Clock snapshot taken when data actually arrives — consumers use it for
  // "starts in Xm" maths so relative labels stay in step with the data and
  // no component reads Date.now() during render (React Compiler purity).
  const [fetchedAt, setFetchedAt] = useState(0);

  // Initial load: `loading` starts true, so every setState here happens after
  // the await (async callback), never synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fsFetchShows();
        if (cancelled) return;
        setShows(data);
        setFetchedAt(Date.now());
      } catch {
        if (!cancelled) setError("Couldn't load shows. Pull to retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull-to-refresh — user-invoked, so the synchronous spinner flip is fine.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setShows(await fsFetchShows());
      setFetchedAt(Date.now());
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
