// src/lib/session.tsx — auth session state for route guarding (expo-router
// Stack.Protected pattern). Firebase persists the session in AsyncStorage, so
// onAuthStateChanged fires with the restored user on cold start.
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';

const AuthContext = createContext<{
  user: User | null;
  isLoading: boolean;
} | null>(null);

export function useSession() {
  const value = use(AuthContext);
  if (!value) throw new Error('useSession must be wrapped in <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      // Unverified accounts are treated as signed out — login() already
      // blocks them, but a stale persisted session could otherwise slip past
      // the guard.
      setUser(u && u.emailVerified ? u : null);
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  return <AuthContext value={{ user, isLoading }}>{children}</AuthContext>;
}
