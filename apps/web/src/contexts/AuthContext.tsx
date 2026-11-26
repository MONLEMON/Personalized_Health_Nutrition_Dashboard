import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { DashboardBootstrapResponse, MeResponseDTO } from '@health-dash/shared';
import { ApiError, configureApiAuth, fetchDashboardBootstrap } from '../lib/api';
import { clearBootstrapCache, readBootstrapCache, writeBootstrapCache } from '../lib/cache';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export interface SignUpResult {
  needsEmailConfirmation: boolean;
  error: string | null;
}

export interface AuthActionResult {
  error: string | null;
}

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  me: MeResponseDTO | null;
  bootstrap: DashboardBootstrapResponse | null;
  authLoading: boolean;
  meLoading: boolean;
  meError: string | null;
  authError: string | null;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signUpWithEmail: (email: string, password: string) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<MeResponseDTO | null>;
  updateBootstrapState: (next: Partial<DashboardBootstrapResponse>) => void;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SUPABASE_MISSING_MSG =
  'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your root .env file.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponseDTO | null>(null);
  const [bootstrap, setBootstrap] = useState<DashboardBootstrapResponse | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isSupabaseConfigured);
  const [meLoading, setMeLoading] = useState<boolean>(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const meRef = useRef<MeResponseDTO | null>(null);
  const bootstrapRef = useRef<DashboardBootstrapResponse | null>(null);
  const loadedTokenRef = useRef<string | null>(null);
  const inFlightTokenRef = useRef<string | null>(null);
  const signingOutRef = useRef<boolean>(false);

  meRef.current = me;
  bootstrapRef.current = bootstrap;

  const updateBootstrapState = useCallback((next: Partial<DashboardBootstrapResponse>) => {
    if (next.me) {
      setMe(next.me);
    }

    setBootstrap((prev) => {
      let merged: DashboardBootstrapResponse | null = null;
      if (prev) {
        merged = { ...prev, ...next };
      } else if (next.me && next.syncStatus) {
        merged = {
          me: next.me,
          dashboard: next.dashboard ?? null,
          trends: next.trends ?? null,
          syncStatus: next.syncStatus,
        };
      }

      const uid = sessionRef.current?.user.id;
      if (merged && uid) {
        writeBootstrapCache(uid, merged);
      }
      return merged;
    });
  }, []);

  const performSignOut = useCallback(async (reason?: string) => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    const prevUserId = sessionRef.current?.user.id;
    try {
      sessionRef.current = null;
      loadedTokenRef.current = null;
      inFlightTokenRef.current = null;
      setSession(null);
      setMe(null);
      setBootstrap(null);
      setMeError(null);
      setMeLoading(false);
      setAuthError(reason ?? null);
      clearBootstrapCache(prevUserId ?? null);
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem('vitalpulse_webhook_key');
        } catch {
          // Ignore storage restrictions
        }
      }
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      // Local session state is already cleared cleanly
    } finally {
      signingOutRef.current = false;
    }
  }, []);

  const handleUnauthorized = useCallback(() => {
    if (!sessionRef.current || signingOutRef.current) {
      return;
    }
    void performSignOut('Your session expired. Please sign in again.');
  }, [performSignOut]);

  const onUnauthorizedRef = useRef(handleUnauthorized);
  onUnauthorizedRef.current = handleUnauthorized;

  // Register synchronously so any mounted consumer always resolves the live token ref.
  configureApiAuth({
    getAccessToken: () => sessionRef.current?.access_token ?? null,
    onUnauthorized: () => onUnauthorizedRef.current(),
  });

  const refreshMe = useCallback(async (): Promise<MeResponseDTO | null> => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      setMe(null);
      setBootstrap(null);
      setMeError(null);
      setMeLoading(false);
      return null;
    }

    const userId = activeSession.user.id;
    const token = activeSession.access_token;
    inFlightTokenRef.current = token;
    setMeLoading(true);
    setMeError(null);

    try {
      const nextBootstrap = await fetchDashboardBootstrap(30);
      if (!sessionRef.current || sessionRef.current.user.id !== userId) {
        return null;
      }
      loadedTokenRef.current = sessionRef.current.access_token;
      setMe(nextBootstrap.me);
      setBootstrap(nextBootstrap);
      writeBootstrapCache(userId, nextBootstrap);
      return nextBootstrap.me;
    } catch (err) {
      if (!sessionRef.current || sessionRef.current.user.id !== userId) {
        return null;
      }
      if (err instanceof ApiError && err.status === 401) {
        return null;
      }
      setMeError(
        err instanceof Error ? err.message : 'Unable to reach VitalPulse API right now.',
      );
      return null;
    } finally {
      if (inFlightTokenRef.current === token) {
        inFlightTokenRef.current = null;
      }
      setMeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;

    const applySession = (nextSession: Session | null) => {
      if (!active) return;

      const prevUserId = sessionRef.current?.user.id ?? null;
      sessionRef.current = nextSession;
      setSession(nextSession);
      setAuthLoading(false);

      if (!nextSession) {
        loadedTokenRef.current = null;
        inFlightTokenRef.current = null;
        setMe(null);
        setBootstrap(null);
        setMeError(null);
        setMeLoading(false);
        return;
      }

      const isSameUser = prevUserId === nextSession.user.id;
      if (!isSameUser) {
        loadedTokenRef.current = null;
        inFlightTokenRef.current = null;
        const cached = readBootstrapCache(nextSession.user.id);
        if (cached) {
          // Hydrate immediately from per-user cache, then refresh live data in background.
          setBootstrap(cached);
          setMe(cached.me);
          setMeError(null);
        } else {
          setBootstrap(null);
          setMe(null);
          setMeError(null);
        }
      } else if (meRef.current && bootstrapRef.current) {
        // Token refresh for an already loaded user keeps existing profile without flicker.
        loadedTokenRef.current = nextSession.access_token;
        return;
      }

      const token = nextSession.access_token;
      if (loadedTokenRef.current === token || inFlightTokenRef.current === token) {
        return;
      }
      void refreshMe();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setAuthError(error.message);
        }
        applySession(data.session ?? null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setAuthError(err instanceof Error ? err.message : 'Failed to initialize auth session.');
        setAuthLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [refreshMe]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      if (!supabase) {
        setAuthError(SUPABASE_MISSING_MSG);
        return { error: SUPABASE_MISSING_MSG };
      }

      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setAuthError(error.message);
        return { error: error.message };
      }

      return { error: null };
    },
    [],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<SignUpResult> => {
      if (!supabase) {
        setAuthError(SUPABASE_MISSING_MSG);
        return { needsEmailConfirmation: false, error: SUPABASE_MISSING_MSG };
      }

      setAuthError(null);
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });

      if (error) {
        setAuthError(error.message);
        return { needsEmailConfirmation: false, error: error.message };
      }

      const needsEmailConfirmation = !data.session;
      return { needsEmailConfirmation, error: null };
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setAuthError(SUPABASE_MISSING_MSG);
      return;
    }

    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });

    if (error) {
      setAuthError(error.message);
    }
  }, []);

  const signOut = useCallback(async () => {
    await performSignOut();
  }, [performSignOut]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      me,
      bootstrap,
      authLoading,
      meLoading,
      meError,
      authError,
      isConfigured: isSupabaseConfigured,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      refreshMe,
      updateBootstrapState,
      clearAuthError,
    }),
    [
      session,
      me,
      bootstrap,
      authLoading,
      meLoading,
      meError,
      authError,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signOut,
      refreshMe,
      updateBootstrapState,
      clearAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
