import { useCallback, useEffect, useState } from 'react';
import type {
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateWorkoutLogInput,
  DashboardTodayResponse,
  MetricsTrendsResponse,
  NutritionLogDTO,
  SyncStatusDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import {
  ApiError,
  createBodyMetric,
  createNutritionLog,
  createNutritionLogsBatch,
  createWorkoutLog,
  deleteNutritionLog,
  deleteWorkoutLog,
  fetchDashboardToday,
  fetchMetricsTrends,
  fetchWebhookSyncStatus,
  toggleSupplement as apiToggleSupplement,
} from '../lib/api';
import { getMockMetricsTrends, mockDashboardToday } from '../data/mockDashboard';
import type { TrendTimeframeDays } from '../components/BodyRecompChart';

const DEFAULT_SYNC_STATUS: SyncStatusDTO = {
  status: 'NEVER',
  last_synced_at: null,
  synced_fields: [],
};

export interface UseDashboardReturn {
  dashboard: DashboardTodayResponse | null;
  trends: MetricsTrendsResponse | null;
  syncStatus: SyncStatusDTO;
  trendDays: TrendTimeframeDays;
  setTrendDays: (days: TrendTimeframeDays) => void;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  isDemoFallback: boolean;
  togglingSupplementKey: string | null;
  submittingLog: boolean;
  refresh: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
  reset: () => void;
  toggleSupplement: (supplementKey: string) => Promise<void>;
  logMeal: (input: CreateNutritionLogInput) => Promise<void>;
  logMealsBatch: (input: CreateBatchNutritionLogsInput) => Promise<void>;
  removeMeal: (id: string) => Promise<void>;
  logWorkout: (input: CreateWorkoutLogInput) => Promise<void>;
  removeWorkout: (id: string) => Promise<void>;
  logBodyMetric: (input: CreateBodyMetricInput) => Promise<void>;
}

function recalculateFallbackDashboard(
  prev: DashboardTodayResponse,
  meals: NutritionLogDTO[],
  workouts: WorkoutLogDTO[],
): DashboardTodayResponse {
  const activeCalories = workouts.reduce((sum, w) => sum + w.activeCalories, 0);
  const dynamicTdee = Math.round(prev.energy.baselineTdee + activeCalories);
  const targetCalories = Math.max(1200, Math.round(dynamicTdee + prev.goal.calorieAdjustment));
  const consumedCalories = meals.reduce((sum, m) => sum + m.calories, 0);
  const remainingCalories = targetCalories - consumedCalories;
  const intakePercentage =
    targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0;

  const proteinConsumed = Math.round(meals.reduce((sum, m) => sum + m.proteinG, 0));
  const carbsConsumed = Math.round(meals.reduce((sum, m) => sum + m.carbsG, 0));
  const fatConsumed = Math.round(meals.reduce((sum, m) => sum + m.fatG, 0));

  const proteinTarget = Math.round(prev.latestMetric.weightKg * prev.goal.proteinPerKg);
  const fatTarget = Math.round((targetCalories * prev.goal.fatRatio) / 9);
  const carbsTarget = Math.max(
    0,
    Math.round((targetCalories - proteinTarget * 4 - fatTarget * 9) / 4),
  );

  return {
    ...prev,
    meals,
    workouts,
    energy: {
      ...prev.energy,
      activeCalories,
      dynamicTdee,
      targetCalories,
      consumedCalories,
      remainingCalories,
      intakePercentage,
    },
    macros: {
      protein: {
        consumed: proteinConsumed,
        target: proteinTarget,
        remaining: Math.max(0, proteinTarget - proteinConsumed),
        percentage: proteinTarget > 0 ? Math.round((proteinConsumed / proteinTarget) * 100) : 0,
      },
      carbs: {
        consumed: carbsConsumed,
        target: carbsTarget,
        remaining: Math.max(0, carbsTarget - carbsConsumed),
        percentage: carbsTarget > 0 ? Math.round((carbsConsumed / carbsTarget) * 100) : 0,
      },
      fat: {
        consumed: fatConsumed,
        target: fatTarget,
        remaining: Math.max(0, fatTarget - fatConsumed),
        percentage: fatTarget > 0 ? Math.round((fatConsumed / fatTarget) * 100) : 0,
      },
    },
  };
}

export function useDashboard(): UseDashboardReturn {
  const [dashboard, setDashboard] = useState<DashboardTodayResponse | null>(null);
  const [trends, setTrends] = useState<MetricsTrendsResponse | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusDTO>(DEFAULT_SYNC_STATUS);
  const [trendDays, setTrendDaysState] = useState<TrendTimeframeDays>(30);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setIsDemoFallback] = useState<boolean>(false);
  const [togglingSupplementKey, setTogglingSupplementKey] = useState<string | null>(null);
  const [submittingLog, setSubmittingLog] = useState<boolean>(false);

  const loadAll = useCallback(async (days: TrendTimeframeDays) => {
    setLoading(true);
    setError(null);
    try {
      const [todayRes, trendsRes, syncRes] = await Promise.all([
        fetchDashboardToday(),
        fetchMetricsTrends(days),
        fetchWebhookSyncStatus().catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            throw err;
          }
          return DEFAULT_SYNC_STATUS;
        }),
      ]);
      setDashboard(todayRes);
      setTrends(trendsRes);
      setSyncStatus(syncRes);
      setIsDemoFallback(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(null);
        return;
      }
      setDashboard((prev) => prev ?? mockDashboardToday);
      setTrends(getMockMetricsTrends(days));
      setSyncStatus(DEFAULT_SYNC_STATUS);
      setIsDemoFallback(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(trendDays);
    // Initial load only; timeframe changes are handled by setTrendDays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    setDashboard(null);
    setTrends(null);
    setSyncStatus(DEFAULT_SYNC_STATUS);
    setError(null);
    setIsDemoFallback(false);
    setLoading(true);
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    try {
      const nextStatus = await fetchWebhookSyncStatus();
      setSyncStatus(nextStatus);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      setSyncStatus(DEFAULT_SYNC_STATUS);
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadAll(trendDays);
  }, [loadAll, trendDays]);

  const setTrendDays = useCallback(
    (days: TrendTimeframeDays) => {
      setTrendDaysState(days);
      if (isDemoFallback) {
        setTrends(getMockMetricsTrends(days));
        return;
      }
      void fetchMetricsTrends(days)
        .then((nextTrends) => {
          setTrends(nextTrends);
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            return;
          }
          setTrends(getMockMetricsTrends(days));
        });
    },
    [isDemoFallback],
  );

  const toggleSupplement = useCallback(
    async (supplementKey: string) => {
      if (!dashboard) return;
      const previous = dashboard;
      setTogglingSupplementKey(supplementKey);
      setError(null);

      // Optimistic toggle
      setDashboard((curr) => {
        if (!curr) return curr;
        return {
          ...curr,
          supplements: curr.supplements.map((item) =>
            item.key === supplementKey ? { ...item, taken: !item.taken } : item,
          ),
        };
      });

      if (isDemoFallback) {
        setTogglingSupplementKey(null);
        return;
      }

      try {
        await apiToggleSupplement({ supplementKey, loggedDate: dashboard.date });
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        setDashboard(previous);
        setError(err instanceof Error ? err.message : 'Failed to toggle supplement');
      } finally {
        setTogglingSupplementKey(null);
      }
    },
    [dashboard, isDemoFallback],
  );

  const logMeal = useCallback(
    async (input: CreateNutritionLogInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            const newMeal: NutritionLogDTO = {
              id: `demo-meal-${Date.now()}`,
              userId: prev.profile.id,
              loggedDate: input.loggedDate ?? prev.date,
              mealType: input.mealType,
              itemName: input.itemName,
              calories: input.calories,
              proteinG: input.proteinG,
              carbsG: input.carbsG,
              fatG: input.fatG,
              supplementKey: null,
              source: 'MANUAL',
              loggedAt: new Date().toISOString(),
            };
            return recalculateFallbackDashboard(prev, [newMeal, ...prev.meals], prev.workouts);
          });
          return;
        }

        await createNutritionLog(input);
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log meal';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback],
  );

  const logMealsBatch = useCallback(
    async (input: CreateBatchNutritionLogsInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          const now = Date.now();
          const loggedAt = new Date(now).toISOString();
          setDashboard((prev) => {
            if (!prev) return prev;
            const newMeals: NutritionLogDTO[] = input.items.map((item, idx) => ({
              id: `demo-meal-${now}-${idx}`,
              userId: prev.profile.id,
              loggedDate: item.loggedDate ?? prev.date,
              mealType: item.mealType,
              itemName: item.itemName,
              calories: item.calories,
              proteinG: item.proteinG,
              carbsG: item.carbsG,
              fatG: item.fatG,
              supplementKey: null,
              source: input.source,
              loggedAt,
            }));
            return recalculateFallbackDashboard(
              prev,
              [...newMeals, ...prev.meals],
              prev.workouts,
            );
          });
          return;
        }

        await createNutritionLogsBatch(input);
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log meals';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback],
  );

  const removeMeal = useCallback(
    async (id: string) => {
      setError(null);
      if (isDemoFallback) {
        setDashboard((prev) => {
          if (!prev) return prev;
          return recalculateFallbackDashboard(
            prev,
            prev.meals.filter((m) => m.id !== id),
            prev.workouts,
          );
        });
        return;
      }

      try {
        await deleteNutritionLog(id);
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete meal');
      }
    },
    [isDemoFallback],
  );

  const logWorkout = useCallback(
    async (input: CreateWorkoutLogInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            const newWorkout: WorkoutLogDTO = {
              id: `demo-workout-${Date.now()}`,
              userId: prev.profile.id,
              loggedDate: input.loggedDate ?? prev.date,
              activityName: input.activityName,
              category: input.category,
              durationMin: input.durationMin,
              activeCalories: input.activeCalories,
              intensity: input.intensity,
              loggedAt: new Date().toISOString(),
            };
            return recalculateFallbackDashboard(prev, prev.meals, [
              newWorkout,
              ...prev.workouts,
            ]);
          });
          return;
        }

        await createWorkoutLog(input);
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log workout';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback],
  );

  const removeWorkout = useCallback(
    async (id: string) => {
      setError(null);
      if (isDemoFallback) {
        setDashboard((prev) => {
          if (!prev) return prev;
          return recalculateFallbackDashboard(
            prev,
            prev.meals,
            prev.workouts.filter((w) => w.id !== id),
          );
        });
        return;
      }

      try {
        await deleteWorkoutLog(id);
        const fresh = await fetchDashboardToday();
        setDashboard(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete workout');
      }
    },
    [isDemoFallback],
  );

  const logBodyMetric = useCallback(
    async (input: CreateBodyMetricInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              latestMetric: {
                ...prev.latestMetric,
                id: `demo-metric-${Date.now()}`,
                recordedDate: input.recordedDate ?? prev.date,
                weightKg: input.weightKg,
                bodyFatPct: input.bodyFatPct ?? prev.latestMetric.bodyFatPct,
                skeletalMuscleMassKg:
                  input.skeletalMuscleMassKg ?? prev.latestMetric.skeletalMuscleMassKg,
                notes: input.notes ?? null,
              },
            };
          });
          return;
        }

        await createBodyMetric(input);
        const [freshDashboard, freshTrends] = await Promise.all([
          fetchDashboardToday(),
          fetchMetricsTrends(trendDays),
        ]);
        setDashboard(freshDashboard);
        setTrends(freshTrends);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log body metric';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, trendDays],
  );

  return {
    dashboard,
    trends,
    syncStatus,
    trendDays,
    setTrendDays,
    loading,
    error,
    clearError: () => setError(null),
    isDemoFallback,
    togglingSupplementKey,
    submittingLog,
    refresh,
    refreshSyncStatus,
    reset,
    toggleSupplement,
    logMeal,
    logMealsBatch,
    removeMeal,
    logWorkout,
    removeWorkout,
    logBodyMetric,
  };
}
