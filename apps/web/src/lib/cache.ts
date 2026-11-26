import type { DashboardBootstrapResponse } from '@health-dash/shared';

const BOOTSTRAP_CACHE_PREFIX = 'vitalpulse_bootstrap_v1:';

function getCacheKey(userId: string): string {
  return `${BOOTSTRAP_CACHE_PREFIX}${userId}`;
}

/**
 * Reads the per-user bootstrap payload from localStorage safely.
 */
export function readBootstrapCache(userId: string): DashboardBootstrapResponse | null {
  if (typeof window === 'undefined' || !userId) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getCacheKey(userId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<DashboardBootstrapResponse> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.me ||
      typeof parsed.me !== 'object' ||
      parsed.me.userId !== userId ||
      !parsed.syncStatus ||
      typeof parsed.syncStatus !== 'object'
    ) {
      return null;
    }

    return parsed as DashboardBootstrapResponse;
  } catch {
    return null;
  }
}

/**
 * Persists the per-user bootstrap payload into localStorage safely.
 */
export function writeBootstrapCache(userId: string, data: DashboardBootstrapResponse): void {
  if (typeof window === 'undefined' || !userId) {
    return;
  }

  try {
    window.localStorage.setItem(getCacheKey(userId), JSON.stringify(data));
  } catch {
    // Ignore storage quota or privacy mode restrictions
  }
}

/**
 * Clears cached bootstrap data for a specific user (or all VitalPulse bootstrap entries).
 */
export function clearBootstrapCache(userId?: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (userId) {
      window.localStorage.removeItem(getCacheKey(userId));
      return;
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(BOOTSTRAP_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage restrictions
  }
}
