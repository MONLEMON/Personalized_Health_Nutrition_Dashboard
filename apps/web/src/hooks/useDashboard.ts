import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BmrFormula,
  CalorieCyclingConfig,
  CalorieCyclingDayType,
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateWorkoutLogInput,
  DashboardBootstrapResponse,
  DashboardTodayResponse,
  MetricsTrendsResponse,
  NutritionLogDTO,
  SupplementConfig,
  SyncStatusDTO,
  TdeeMode,
  UpdateProfileSettingsInput,
  WeekdayKey,
  WeeklyBudgetDayDTO,
  WeeklyBudgetSummaryDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import { useAuth } from '../contexts/AuthContext';
import {
  ApiError,
  createBodyMetric,
  createNutritionLog,
  createNutritionLogsBatch,
  createWorkoutLog,
  deleteNutritionLog,
  deleteWorkoutLog,
  fetchDashboardBootstrap,
  fetchDashboardToday,
  fetchMetricsTrends,
  fetchWebhookSyncStatus,
  toggleSupplement as apiToggleSupplement,
  updateProfileSettings as apiUpdateProfileSettings,
  updateSupplementStack as apiUpdateSupplementStack,
} from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase';
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
  saveSupplementStack: (supplements: SupplementConfig[]) => Promise<void>;
  saveProfileSettings: (input: UpdateProfileSettingsInput) => Promise<void>;
}

function calculateAgeFromBirthDate(birthDate: string, referenceDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ry, rm, rd] = referenceDate.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) {
    age -= 1;
  }
  return Math.max(0, Number.isFinite(age) ? age : 30);
}

const WEEKDAY_KEYS_UTC: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_SHORT_LABELS: Record<WeekdayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function getWeekdayKeyFromIso(isoDate: string): WeekdayKey {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAY_KEYS_UTC[dt.getUTCDay()] ?? 'mon';
}

function shiftIsoDateUtc(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function resolveFallbackCycling(
  config: CalorieCyclingConfig | null | undefined,
  isoDate: string,
  hasLoggedWorkout: boolean,
): { offset: number; dayType: CalorieCyclingDayType; label: string | null } {
  if (!config || !config.enabled || config.mode === 'NONE') {
    return { offset: 0, dayType: 'base', label: null };
  }

  const weekday = getWeekdayKeyFromIso(isoDate);
  let offset = 0;
  let isTraining = false;

  if (config.mode === 'TRAINING_REST') {
    isTraining = hasLoggedWorkout || config.trainingDays.includes(weekday);
    offset = isTraining ? config.trainingDayOffset : config.restDayOffset;
  } else {
    offset = config.dayOffsets[weekday] ?? 0;
  }

  const dayType: CalorieCyclingDayType = offset > 0 ? 'high' : offset < 0 ? 'low' : 'base';
  const signedOffset = `${offset >= 0 ? '+' : ''}${offset} kcal`;

  let label: string;
  if (config.mode === 'TRAINING_REST') {
    if (offset === 0) {
      label = isTraining ? 'Training Day (±0 kcal)' : 'Rest Day (±0 kcal)';
    } else {
      label = `${isTraining ? 'Training' : 'Rest'} ${dayType === 'high' ? 'High' : 'Low'} (${signedOffset})`;
    }
  } else if (config.mode === 'WEEKEND_BUFFER') {
    label =
      offset > 0
        ? `Weekend Buffer (${signedOffset})`
        : offset < 0
          ? `Weekday Save (${signedOffset})`
          : 'Base Day';
  } else {
    label =
      dayType === 'high'
        ? `Custom High (${signedOffset})`
        : dayType === 'low'
          ? `Custom Low (${signedOffset})`
          : 'Base Day';
  }

  return { offset, dayType, label };
}

function buildFallbackWeeklyBudget(
  todayDate: string,
  baselineTdee: number,
  todayActiveCalories: number,
  todayConsumedCalories: number,
  calorieAdjustment: number,
  cyclingConfig: CalorieCyclingConfig | null | undefined,
  hasTodayWorkout: boolean,
  tdeeMode: TdeeMode = 'MANUAL_WORKOUT_DYNAMIC',
): WeeklyBudgetSummaryDTO {
  const [y, m, d] = todayDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const dow = utc.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const weekStartDate = shiftIsoDateUtc(todayDate, diffToMon);
  const weekEndDate = shiftIsoDateUtc(weekStartDate, 6);

  const days: WeeklyBudgetDayDTO[] = [];
  let weeklyTargetCalories = 0;
  let weeklyConsumedCalories = 0;
  let daysElapsed = 0;

  for (let i = 0; i < 7; i += 1) {
    const date = shiftIsoDateUtc(weekStartDate, i);
    const weekday = getWeekdayKeyFromIso(date);
    const isToday = date === todayDate;
    const isFuture = date > todayDate;
    const resolved = resolveFallbackCycling(
      cyclingConfig,
      date,
      isToday ? hasTodayWorkout : false,
    );
    const effectiveTodayActive =
      isToday && tdeeMode !== 'FIXED_STATIC' ? todayActiveCalories : 0;
    const dayDynamicTdee = baselineTdee + effectiveTodayActive;
    const targetCalories = Math.max(
      1200,
      Math.round(dayDynamicTdee + calorieAdjustment + resolved.offset),
    );
    const consumedCalories = isToday
      ? todayConsumedCalories
      : isFuture
        ? 0
        : Math.round(targetCalories * 0.94);

    if (!isFuture) {
      daysElapsed += 1;
    }
    weeklyTargetCalories += targetCalories;
    weeklyConsumedCalories += consumedCalories;

    days.push({
      date,
      weekday,
      dayLabel: WEEKDAY_SHORT_LABELS[weekday],
      dayType: resolved.dayType,
      cyclingOffset: resolved.offset,
      targetCalories,
      consumedCalories,
      isToday,
      isFuture,
    });
  }

  return {
    weekStartDate,
    weekEndDate,
    weeklyTargetCalories,
    weeklyConsumedCalories,
    weeklyRemainingCalories: weeklyTargetCalories - weeklyConsumedCalories,
    daysElapsed,
    cyclingEnabled: Boolean(cyclingConfig?.enabled && cyclingConfig.mode !== 'NONE'),
    cyclingMode: cyclingConfig?.enabled ? cyclingConfig.mode : 'NONE',
    days,
  };
}

function recalculateFallbackDashboard(
  prev: DashboardTodayResponse,
  meals: NutritionLogDTO[],
  workouts: WorkoutLogDTO[],
): DashboardTodayResponse {
  const activeCalories = workouts.reduce((sum, w) => sum + w.activeCalories, 0);
  const resolvedTdeeMode: TdeeMode =
    prev.profile.tdeeMode ?? prev.energy.tdeeMode ?? 'MANUAL_WORKOUT_DYNAMIC';
  const effectiveActiveCalories =
    resolvedTdeeMode === 'FIXED_STATIC' ? 0 : Math.round(activeCalories);
  const dynamicTdee = Math.round(prev.energy.baselineTdee + effectiveActiveCalories);
  const cycling = resolveFallbackCycling(prev.goal.calorieCycling, prev.date, workouts.length > 0);
  const baseTargetCalories = Math.max(1200, Math.round(dynamicTdee + prev.goal.calorieAdjustment));
  const targetCalories = Math.max(
    1200,
    Math.round(dynamicTdee + prev.goal.calorieAdjustment + cycling.offset),
  );
  const consumedCalories = meals.reduce((sum, m) => sum + m.calories, 0);
  const remainingCalories = targetCalories - consumedCalories;
  const intakePercentage =
    targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0;

  const proteinConsumed = Math.round(meals.reduce((sum, m) => sum + m.proteinG, 0));
  const carbsConsumed = Math.round(meals.reduce((sum, m) => sum + m.carbsG, 0));
  const fatConsumed = Math.round(meals.reduce((sum, m) => sum + m.fatG, 0));

  const proteinTarget = Math.round(prev.latestMetric.weightKg * prev.goal.proteinPerKg);
  const fatTarget = Math.round((baseTargetCalories * prev.goal.fatRatio) / 9);
  const carbsTarget = Math.max(
    0,
    Math.round((targetCalories - proteinTarget * 4 - fatTarget * 9) / 4),
  );

  const weeklyBudget =
    prev.weeklyBudget || prev.goal.calorieCycling?.enabled
      ? buildFallbackWeeklyBudget(
          prev.date,
          prev.energy.baselineTdee,
          activeCalories,
          consumedCalories,
          prev.goal.calorieAdjustment,
          prev.goal.calorieCycling,
          workouts.length > 0,
          resolvedTdeeMode,
        )
      : undefined;

  return {
    ...prev,
    meals,
    workouts,
    weeklyBudget,
    energy: {
      ...prev.energy,
      activeCalories,
      effectiveActiveCalories,
      tdeeMode: resolvedTdeeMode,
      dynamicTdee,
      cyclingOffset: cycling.offset,
      cyclingDayType: cycling.dayType,
      cyclingLabel: cycling.label,
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

function recalculateFallbackSettings(
  prev: DashboardTodayResponse,
  input: UpdateProfileSettingsInput,
): DashboardTodayResponse {
  const age = calculateAgeFromBirthDate(input.birth_date, prev.date);
  const weightKg = prev.latestMetric.weightKg;
  const bodyFatPct = prev.latestMetric.bodyFatPct;

  let bmr: number;
  let bmrFormula: BmrFormula;
  let leanBodyMassKg: number | null;
  if (bodyFatPct !== null && Number.isFinite(bodyFatPct)) {
    const rawLbm = weightKg * (1 - bodyFatPct / 100);
    bmr = Math.round(370 + 21.6 * rawLbm);
    bmrFormula = 'katch_mcardle';
    leanBodyMassKg = Math.round(rawLbm * 100) / 100;
  } else {
    const offset = input.gender === 'male' ? 5 : input.gender === 'female' ? -161 : -78;
    bmr = Math.round(10 * weightKg + 6.25 * input.height_cm - 5 * age + offset);
    bmrFormula = 'mifflin_st_jeor';
    leanBodyMassKg = null;
  }

  const baselineTdee = Math.round(bmr * input.baseline_activity_multiplier);
  const updated: DashboardTodayResponse = {
    ...prev,
    profile: {
      ...prev.profile,
      name: input.name,
      sex: input.gender,
      birthDate: input.birth_date,
      age,
      heightCm: input.height_cm,
      baselineActivityMultiplier: input.baseline_activity_multiplier,
      tdeeMode: input.tdee_mode ?? prev.profile.tdeeMode ?? 'MANUAL_WORKOUT_DYNAMIC',
    },
    goal: {
      ...prev.goal,
      goalType: input.goal_type,
      calorieAdjustment: input.calorie_adjustment,
      proteinPerKg: input.protein_per_kg,
      fatRatio: input.fat_ratio,
      calorieCycling: input.calorie_cycling ?? prev.goal.calorieCycling ?? null,
    },
    energy: {
      ...prev.energy,
      bmr,
      bmrFormula,
      leanBodyMassKg,
      baselineTdee,
      calorieAdjustment: input.calorie_adjustment,
    },
  };

  return recalculateFallbackDashboard(updated, updated.meals, updated.workouts);
}

function mergeSupplementStatuses(
  prevSupplements: DashboardTodayResponse['supplements'],
  nextConfigs: SupplementConfig[],
): DashboardTodayResponse['supplements'] {
  const takenByKey = new Map(prevSupplements.map((s) => [s.key, s.taken]));
  return nextConfigs.map((cfg) => ({
    ...cfg,
    taken: takenByKey.get(cfg.key) ?? false,
  }));
}

export function useDashboard(): UseDashboardReturn {
  const { session, bootstrap, updateBootstrapState } = useAuth();

  const [dashboard, setDashboard] = useState<DashboardTodayResponse | null>(
    () => bootstrap?.dashboard ?? null,
  );
  const [trends, setTrends] = useState<MetricsTrendsResponse | null>(
    () => bootstrap?.trends ?? null,
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatusDTO>(
    () => bootstrap?.syncStatus ?? DEFAULT_SYNC_STATUS,
  );
  const [trendDays, setTrendDaysState] = useState<TrendTimeframeDays>(30);
  const [loading, setLoading] = useState<boolean>(() => !bootstrap?.dashboard);
  const [error, setError] = useState<string | null>(null);
  const [isDemoFallback, setIsDemoFallback] = useState<boolean>(false);
  const [togglingSupplementKey, setTogglingSupplementKey] = useState<string | null>(null);
  const [submittingLog, setSubmittingLog] = useState<boolean>(false);

  const lastAppliedBootstrapRef = useRef<DashboardBootstrapResponse | null>(
    bootstrap?.dashboard ? bootstrap : null,
  );
  const bootstrappedUserRef = useRef<string | null>(
    bootstrap?.dashboard && session?.user.id ? session.user.id : null,
  );
  const devLoadedRef = useRef<boolean>(false);
  const trendsRef = useRef<MetricsTrendsResponse | null>(trends);
  const trendDaysRef = useRef<TrendTimeframeDays>(trendDays);
  trendsRef.current = trends;
  trendDaysRef.current = trendDays;

  const loadAll = useCallback(
    async (days: TrendTimeframeDays) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchDashboardBootstrap(days);
        if (res.dashboard) {
          setDashboard(res.dashboard);
        } else {
          setDashboard((prev) => prev ?? mockDashboardToday);
        }
        if (res.trends) {
          setTrends(res.trends);
        }
        setSyncStatus(res.syncStatus);
        setIsDemoFallback(false);
        if (session?.user.id) {
          lastAppliedBootstrapRef.current = res;
          bootstrappedUserRef.current = session.user.id;
          updateBootstrapState(res);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setError(null);
          return;
        }
        setDashboard((prev) => {
          if (prev) {
            setError(err instanceof Error ? err.message : 'Unable to refresh dashboard.');
            return prev;
          }
          setTrends(getMockMetricsTrends(days));
          setSyncStatus(DEFAULT_SYNC_STATUS);
          setIsDemoFallback(true);
          return mockDashboardToday;
        });
      } finally {
        setLoading(false);
      }
    },
    [session?.user.id, updateBootstrapState],
  );

  useEffect(() => {
    if (bootstrap && bootstrap !== lastAppliedBootstrapRef.current) {
      lastAppliedBootstrapRef.current = bootstrap;
      if (bootstrap.dashboard) {
        setDashboard(bootstrap.dashboard);
        setSyncStatus(bootstrap.syncStatus);
        setIsDemoFallback(false);
        setLoading(false);
        setError(null);
        if (
          bootstrap.trends &&
          (bootstrap.trends.days === trendDaysRef.current || !trendsRef.current)
        ) {
          setTrends(bootstrap.trends);
        }
        if (session?.user.id) {
          bootstrappedUserRef.current = session.user.id;
        }
        return;
      }
    }

    if (!isSupabaseConfigured) {
      if (!devLoadedRef.current) {
        devLoadedRef.current = true;
        void loadAll(trendDaysRef.current);
      }
      return;
    }

    if (!session?.user.id) {
      lastAppliedBootstrapRef.current = null;
      bootstrappedUserRef.current = null;
      return;
    }

    if (!bootstrap?.dashboard && bootstrappedUserRef.current !== session.user.id) {
      bootstrappedUserRef.current = session.user.id;
      void loadAll(trendDaysRef.current);
    }
  }, [bootstrap, loadAll, session?.user.id]);

  const reset = useCallback(() => {
    lastAppliedBootstrapRef.current = null;
    bootstrappedUserRef.current = null;
    devLoadedRef.current = false;
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
      updateBootstrapState({ syncStatus: nextStatus });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      setSyncStatus(DEFAULT_SYNC_STATUS);
    }
  }, [updateBootstrapState]);

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
          if (days === 30) {
            updateBootstrapState({ trends: nextTrends });
          }
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            return;
          }
          setTrends(getMockMetricsTrends(days));
        });
    },
    [isDemoFallback, updateBootstrapState],
  );

  const syncDashboardToCache = useCallback(
    (fresh: DashboardTodayResponse) => {
      setDashboard(fresh);
      updateBootstrapState({ dashboard: fresh });
    },
    [updateBootstrapState],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        setDashboard(previous);
        setError(err instanceof Error ? err.message : 'Failed to toggle supplement');
      } finally {
        setTogglingSupplementKey(null);
      }
    },
    [dashboard, isDemoFallback, syncDashboardToCache],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log meal';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log meals';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete meal');
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log workout';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
        syncDashboardToCache(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete workout');
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
        updateBootstrapState({
          dashboard: freshDashboard,
          ...(trendDays === 30 ? { trends: freshTrends } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log body metric';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, trendDays, updateBootstrapState],
  );

  const saveSupplementStack = useCallback(
    async (supplements: SupplementConfig[]) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              profile: { ...prev.profile, supplementStack: supplements },
              supplements: mergeSupplementStatuses(prev.supplements, supplements),
            };
          });
          return;
        }

        const res = await apiUpdateSupplementStack({ supplements });
        setDashboard((prev) => {
          if (!prev) return prev;
          const nextDashboard: DashboardTodayResponse = {
            ...prev,
            profile: { ...prev.profile, supplementStack: res.supplementStack },
            supplements: mergeSupplementStatuses(prev.supplements, res.supplementStack),
          };
          updateBootstrapState({ dashboard: nextDashboard });
          return nextDashboard;
        });

        const fresh = await fetchDashboardBootstrap(trendDays);
        if (fresh.dashboard) {
          setDashboard(fresh.dashboard);
        }
        if (fresh.trends) {
          setTrends(fresh.trends);
        }
        setSyncStatus(fresh.syncStatus);
        lastAppliedBootstrapRef.current = fresh;
        updateBootstrapState(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update supplement stack';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, trendDays, updateBootstrapState],
  );

  const saveProfileSettings = useCallback(
    async (input: UpdateProfileSettingsInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => (prev ? recalculateFallbackSettings(prev, input) : prev));
          return;
        }

        const updatedMe = await apiUpdateProfileSettings(input);
        const fresh = await fetchDashboardBootstrap(trendDays);
        const syncedBootstrap: DashboardBootstrapResponse = {
          ...fresh,
          me: fresh.me ?? updatedMe,
        };
        if (syncedBootstrap.dashboard) {
          setDashboard(syncedBootstrap.dashboard);
        }
        if (syncedBootstrap.trends) {
          setTrends(syncedBootstrap.trends);
        }
        setSyncStatus(syncedBootstrap.syncStatus);
        lastAppliedBootstrapRef.current = syncedBootstrap;
        updateBootstrapState(syncedBootstrap);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update profile settings';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, trendDays, updateBootstrapState],
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
    saveSupplementStack,
    saveProfileSettings,
  };
}
