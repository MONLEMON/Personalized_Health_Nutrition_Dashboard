import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BmrFormula,
  CalorieCyclingConfig,
  CalorieCyclingDayType,
  CopyYesterdayMealsInput,
  CopyYesterdayMealsResponse,
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateSavedMealInput,
  CreateWorkoutLogInput,
  DashboardBootstrapResponse,
  DashboardTodayResponse,
  HydrationEntryDTO,
  LogSavedMealInput,
  MetricsTrendsResponse,
  NutritionLogDTO,
  RecentMealSuggestionDTO,
  SavedMealDTO,
  SupplementConfig,
  SyncStatusDTO,
  TdeeMode,
  UpdateNutritionLogInput,
  UpdateProfileSettingsInput,
  WaterLogSummaryDTO,
  WeekdayKey,
  WeeklyBudgetDayDTO,
  WeeklyBudgetSummaryDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import { useAuth } from '../contexts/AuthContext';
import {
  ApiError,
  addWaterLog as apiAddWaterLog,
  copyYesterdayMeals as apiCopyYesterdayMeals,
  createBodyMetric,
  createNutritionLog,
  createNutritionLogsBatch,
  createSavedMeal as apiCreateSavedMeal,
  createWorkoutLog,
  deleteNutritionLog,
  deleteSavedMeal as apiDeleteSavedMeal,
  deleteWaterLog as apiDeleteWaterLog,
  deleteWorkoutLog,
  fetchDashboardBootstrap,
  fetchDashboardToday,
  fetchMetricsTrends,
  fetchSavedMeals as apiFetchSavedMeals,
  fetchWebhookSyncStatus,
  logSavedMeal as apiLogSavedMeal,
  toggleSupplement as apiToggleSupplement,
  updateNutritionLog as apiUpdateNutritionLog,
  updateProfileSettings as apiUpdateProfileSettings,
  updateSupplementStack as apiUpdateSupplementStack,
} from '../lib/api';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  getMockMetricsTrends,
  mockDashboardToday,
  mockRecentMeals,
  mockSavedMeals,
} from '../data/mockDashboard';
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
  isHydrationBusy: boolean;
  savedMeals: SavedMealDTO[];
  recentMeals: RecentMealSuggestionDTO[];
  isSavedMealsLoading: boolean;
  refresh: () => Promise<void>;
  refreshSyncStatus: () => Promise<void>;
  reset: () => void;
  toggleSupplement: (supplementKey: string) => Promise<void>;
  logMeal: (input: CreateNutritionLogInput) => Promise<void>;
  updateMeal: (id: string, input: UpdateNutritionLogInput) => Promise<void>;
  logMealsBatch: (input: CreateBatchNutritionLogsInput) => Promise<void>;
  removeMeal: (id: string) => Promise<void>;
  logWorkout: (input: CreateWorkoutLogInput) => Promise<void>;
  removeWorkout: (id: string) => Promise<void>;
  logBodyMetric: (input: CreateBodyMetricInput) => Promise<void>;
  saveSupplementStack: (supplements: SupplementConfig[]) => Promise<void>;
  saveProfileSettings: (input: UpdateProfileSettingsInput) => Promise<void>;
  fetchSavedMeals: () => Promise<void>;
  createSavedMeal: (input: CreateSavedMealInput) => Promise<SavedMealDTO>;
  deleteSavedMeal: (id: string) => Promise<void>;
  logSavedMeal: (savedMealId: string, input?: LogSavedMealInput) => Promise<void>;
  copyYesterdayMeals: (input?: CopyYesterdayMealsInput) => Promise<CopyYesterdayMealsResponse>;
  addWater: (amountMl: number) => Promise<void>;
  deleteWater: (id: string) => Promise<void>;
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

function round50(val: number): number {
  return Math.round(val / 50) * 50;
}

function hasCreatineInStack(
  supplementStack: SupplementConfig[],
  supplements: DashboardTodayResponse['supplements'],
): boolean {
  return (
    supplementStack.some((s) => /creatine/i.test(s.key) || /creatine/i.test(s.name)) ||
    supplements.some((s) => /creatine/i.test(s.key) || /creatine/i.test(s.name))
  );
}

function buildFallbackHydration(
  dashboard: DashboardTodayResponse,
  workouts: WorkoutLogDTO[],
  entriesOverride?: HydrationEntryDTO[],
): WaterLogSummaryDTO {
  const clampedBase = Math.min(4500, Math.max(1500, dashboard.latestMetric.weightKg * 35));
  const baseMl = round50(clampedBase);
  const activeCalories = workouts.reduce((sum, w) => sum + w.activeCalories, 0);
  const workoutBonusMl = Math.min(1000, round50(activeCalories * 0.5));
  const creatineBonusMl = hasCreatineInStack(
    dashboard.profile.supplementStack,
    dashboard.supplements,
  )
    ? 500
    : 0;
  const targetMl = baseMl + workoutBonusMl + creatineBonusMl;
  const entries = entriesOverride ?? dashboard.hydration?.entries ?? [];
  const consumedMl = entries.reduce((sum, entry) => sum + entry.amountMl, 0);
  const remainingMl = Math.max(0, targetMl - consumedMl);
  const percentage = targetMl > 0 ? Math.round((consumedMl / targetMl) * 100) : 0;

  return {
    date: dashboard.date,
    consumedMl,
    targetMl,
    remainingMl,
    percentage,
    breakdown: {
      baseMl,
      workoutBonusMl,
      creatineBonusMl,
    },
    entries,
  };
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

  const hydration = buildFallbackHydration(prev, workouts);

  return {
    ...prev,
    meals,
    workouts,
    weeklyBudget,
    hydration,
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
  const [isHydrationBusy, setIsHydrationBusy] = useState<boolean>(false);

  const [savedMeals, setSavedMeals] = useState<SavedMealDTO[]>([]);
  const [recentMeals, setRecentMeals] = useState<RecentMealSuggestionDTO[]>([]);
  const [isSavedMealsLoading, setIsSavedMealsLoading] = useState<boolean>(false);

  const lastAppliedBootstrapRef = useRef<DashboardBootstrapResponse | null>(
    bootstrap?.dashboard ? bootstrap : null,
  );
  const bootstrappedUserRef = useRef<string | null>(
    bootstrap?.dashboard && session?.user.id ? session.user.id : null,
  );
  const devLoadedRef = useRef<boolean>(false);
  const dashboardRef = useRef<DashboardTodayResponse | null>(dashboard);
  const trendsRef = useRef<MetricsTrendsResponse | null>(trends);
  const trendDaysRef = useRef<TrendTimeframeDays>(trendDays);
  const savedMealsRef = useRef<SavedMealDTO[]>(savedMeals);
  const recentMealsRef = useRef<RecentMealSuggestionDTO[]>(recentMeals);

  dashboardRef.current = dashboard;
  trendsRef.current = trends;
  trendDaysRef.current = trendDays;
  savedMealsRef.current = savedMeals;
  recentMealsRef.current = recentMeals;

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
          setSavedMeals((curr) => (curr.length > 0 ? curr : mockSavedMeals));
          setRecentMeals((curr) => (curr.length > 0 ? curr : mockRecentMeals));
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
    setSavedMeals([]);
    setRecentMeals([]);
    setIsSavedMealsLoading(false);
    setIsHydrationBusy(false);
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

  const updateMeal = useCallback(
    async (id: string, input: UpdateNutritionLogInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            const nextMeals = prev.meals.map((meal) =>
              meal.id === id
                ? {
                    ...meal,
                    itemName: input.itemName,
                    mealType: input.mealType,
                    calories: input.calories,
                    proteinG: input.proteinG,
                    carbsG: input.carbsG,
                    fatG: input.fatG,
                  }
                : meal,
            );
            return recalculateFallbackDashboard(prev, nextMeals, prev.workouts);
          });
          return;
        }

        const updatedMeal = await apiUpdateNutritionLog(id, input);
        setDashboard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            meals: prev.meals.map((meal) => (meal.id === id ? updatedMeal : meal)),
          };
        });
        const fresh = await fetchDashboardToday();
        syncDashboardToCache(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update meal';
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
            const updated: DashboardTodayResponse = {
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
            return recalculateFallbackDashboard(updated, updated.meals, updated.workouts);
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
            const nextDashboard: DashboardTodayResponse = {
              ...prev,
              profile: { ...prev.profile, supplementStack: supplements },
              supplements: mergeSupplementStatuses(prev.supplements, supplements),
            };
            return {
              ...nextDashboard,
              hydration: buildFallbackHydration(nextDashboard, nextDashboard.workouts),
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

  const fetchSavedMeals = useCallback(async () => {
    if (isDemoFallback) {
      setSavedMeals((curr) => (curr.length > 0 ? curr : mockSavedMeals));
      setRecentMeals((curr) => (curr.length > 0 ? curr : mockRecentMeals));
      return;
    }

    setIsSavedMealsLoading(true);
    try {
      const res = await apiFetchSavedMeals();
      setSavedMeals(res.savedMeals);
      setRecentMeals(res.recentMeals);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load saved meals');
    } finally {
      setIsSavedMealsLoading(false);
    }
  }, [isDemoFallback]);

  const createSavedMeal = useCallback(
    async (input: CreateSavedMealInput): Promise<SavedMealDTO> => {
      setError(null);
      try {
        if (isDemoFallback) {
          const created: SavedMealDTO = {
            id: `demo-saved-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: dashboardRef.current?.profile.id ?? 'user-thanawat',
            name: input.name,
            defaultMealType: input.defaultMealType,
            calories: input.calories,
            proteinG: input.proteinG,
            carbsG: input.carbsG,
            fatG: input.fatG,
            servingNote: input.servingNote ?? null,
            usageCount: 0,
            lastUsedAt: null,
            createdAt: new Date().toISOString(),
          };
          setSavedMeals((prev) => [created, ...prev]);
          return created;
        }

        const created = await apiCreateSavedMeal(input);
        setSavedMeals((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save favorite meal';
        setError(message);
        throw err;
      }
    },
    [isDemoFallback],
  );

  const deleteSavedMeal = useCallback(
    async (id: string) => {
      setError(null);
      try {
        if (isDemoFallback) {
          setSavedMeals((prev) => prev.filter((item) => item.id !== id));
          return;
        }

        await apiDeleteSavedMeal(id);
        setSavedMeals((prev) => prev.filter((item) => item.id !== id));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete saved meal';
        setError(message);
        throw err;
      }
    },
    [isDemoFallback],
  );

  const logSavedMeal = useCallback(
    async (savedMealId: string, input?: LogSavedMealInput) => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          const list = savedMealsRef.current.length > 0 ? savedMealsRef.current : mockSavedMeals;
          const target = list.find((item) => item.id === savedMealId);
          if (!target) {
            throw new Error('Saved meal not found.');
          }
          const multiplier = input?.multiplier ?? 1;
          const mealType = input?.mealType ?? target.defaultMealType;
          const loggedAt = new Date().toISOString();

          setDashboard((prev) => {
            if (!prev) return prev;
            const loggedMeal: NutritionLogDTO = {
              id: `demo-meal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              userId: prev.profile.id,
              loggedDate: input?.loggedDate ?? prev.date,
              mealType,
              itemName: multiplier !== 1 ? `${target.name} (${multiplier}x)` : target.name,
              calories: Math.round(target.calories * multiplier),
              proteinG: Math.round(target.proteinG * multiplier * 10) / 10,
              carbsG: Math.round(target.carbsG * multiplier * 10) / 10,
              fatG: Math.round(target.fatG * multiplier * 10) / 10,
              supplementKey: null,
              source: 'MANUAL',
              loggedAt,
            };
            return recalculateFallbackDashboard(prev, [loggedMeal, ...prev.meals], prev.workouts);
          });

          setSavedMeals((prev) =>
            prev
              .map((item) =>
                item.id === savedMealId
                  ? { ...item, usageCount: item.usageCount + 1, lastUsedAt: loggedAt }
                  : item,
              )
              .sort((a, b) => b.usageCount - a.usageCount),
          );
          return;
        }

        const res = await apiLogSavedMeal(savedMealId, input);
        setSavedMeals((prev) =>
          prev
            .map((item) => (item.id === res.savedMeal.id ? res.savedMeal : item))
            .sort((a, b) => b.usageCount - a.usageCount),
        );
        const fresh = await fetchDashboardToday();
        syncDashboardToCache(fresh);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log saved meal';
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
  );

  const copyYesterdayMeals = useCallback(
    async (input?: CopyYesterdayMealsInput): Promise<CopyYesterdayMealsResponse> => {
      setSubmittingLog(true);
      setError(null);
      try {
        if (isDemoFallback) {
          const curr = dashboardRef.current ?? mockDashboardToday;
          const targetDate = input?.targetDate ?? curr.date;
          const sourceDate = input?.sourceDate ?? shiftIsoDateUtc(targetDate, -1);
          const sourceCandidates =
            recentMealsRef.current.length > 0 ? recentMealsRef.current : mockRecentMeals;
          const allowedTypes = input?.mealTypes ? new Set(input.mealTypes) : null;
          const matched = sourceCandidates
            .filter((item) => !allowedTypes || allowedTypes.has(item.mealType))
            .slice(0, 2);

          const now = Date.now();
          const loggedAt = new Date(now).toISOString();
          const copiedItems: NutritionLogDTO[] = matched.map((item, idx) => ({
            id: `demo-copy-${now}-${idx}`,
            userId: curr.profile.id,
            loggedDate: targetDate,
            mealType: item.mealType,
            itemName: item.itemName,
            calories: item.calories,
            proteinG: item.proteinG,
            carbsG: item.carbsG,
            fatG: item.fatG,
            supplementKey: null,
            source: 'MANUAL',
            loggedAt,
          }));

          if (copiedItems.length > 0) {
            setDashboard((prev) =>
              prev
                ? recalculateFallbackDashboard(prev, [...copiedItems, ...prev.meals], prev.workouts)
                : prev,
            );
          }

          return {
            copiedCount: copiedItems.length,
            sourceDate,
            targetDate,
            items: copiedItems,
          };
        }

        const res = await apiCopyYesterdayMeals(input);
        if (res.copiedCount > 0) {
          const fresh = await fetchDashboardToday();
          syncDashboardToCache(fresh);
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to copy yesterday's meals";
        setError(message);
        throw err;
      } finally {
        setSubmittingLog(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
  );

  const addWater = useCallback(
    async (amountMl: number) => {
      setIsHydrationBusy(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            const newEntry: HydrationEntryDTO = {
              id: `demo-water-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              amountMl,
              loggedAt: new Date().toISOString(),
            };
            const nextEntries = [newEntry, ...(prev.hydration?.entries ?? [])];
            return {
              ...prev,
              hydration: buildFallbackHydration(prev, prev.workouts, nextEntries),
            };
          });
          return;
        }

        const summary = await apiAddWaterLog({
          amountMl,
          loggedDate: dashboardRef.current?.date,
        });
        const curr = dashboardRef.current;
        if (curr) {
          syncDashboardToCache({ ...curr, hydration: summary });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to log water';
        setError(message);
      } finally {
        setIsHydrationBusy(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
  );

  const deleteWater = useCallback(
    async (id: string) => {
      setIsHydrationBusy(true);
      setError(null);
      try {
        if (isDemoFallback) {
          setDashboard((prev) => {
            if (!prev) return prev;
            const nextEntries = (prev.hydration?.entries ?? []).filter((entry) => entry.id !== id);
            return {
              ...prev,
              hydration: buildFallbackHydration(prev, prev.workouts, nextEntries),
            };
          });
          return;
        }

        const summary = await apiDeleteWaterLog(id);
        const curr = dashboardRef.current;
        if (curr) {
          syncDashboardToCache({ ...curr, hydration: summary });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove water log';
        setError(message);
      } finally {
        setIsHydrationBusy(false);
      }
    },
    [isDemoFallback, syncDashboardToCache],
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
    isHydrationBusy,
    savedMeals,
    recentMeals,
    isSavedMealsLoading,
    refresh,
    refreshSyncStatus,
    reset,
    toggleSupplement,
    logMeal,
    updateMeal,
    logMealsBatch,
    removeMeal,
    logWorkout,
    removeWorkout,
    logBodyMetric,
    saveSupplementStack,
    saveProfileSettings,
    fetchSavedMeals,
    createSavedMeal,
    deleteSavedMeal,
    logSavedMeal,
    copyYesterdayMeals,
    addWater,
    deleteWater,
  };
}
