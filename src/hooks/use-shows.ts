import { useCallback, useEffect, useState } from 'react';

import type { ShowData } from '@/lib/api';
import { fsFetchShows } from '@/lib/shows';

export function useShows() {
  const [shows, setShows] = useState<ShowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (asRefresh = false) => {
    asRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setShows(await fsFetchShows());
    } catch {
      setError("Couldn't load shows. Pull to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    refresh: () => load(true),
  };
}
