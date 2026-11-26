import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  AppleHealthWebhookPayload,
  AppleHealthWebhookResponse,
  ApplyWeeklyCoachResponse,
  BodyMetricDTO,
  CalendarDayStatus,
  CalendarDaySummaryDTO,
  CalorieCyclingConfig,
  CalorieCyclingMode,
  DashboardBootstrapResponse,
  DashboardTodayResponse,
  MacroProgress,
  MeResponseDTO,
  MetricsTrendsResponse,
  MonthlyCalendarResponse,
  MonthlyCalendarSummaryDTO,
  NutritionLogDTO,
  NutritionLogSource,
  SupplementConfig,
  SupplementStatusDTO,
  SyncStatusDTO,
  UserGoalDTO,
  UserProfileDTO,
  WebhookKeyResponse,
  WebhookKeyStatusDTO,
  WeekdayKey,
  WeeklyBudgetDayDTO,
  WeeklyBudgetSummaryDTO,
  WeeklyCoachReportDTO,
  WeeklyCoachStatusResponse,
  WorkoutLogDTO,
} from '@health-dash/shared';
import type {
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateWorkoutLogInput,
  OnboardingProfileInput,
  ToggleSupplementInput,
  UpdateProfileSettingsInput,
} from '@health-dash/shared';
import { getDb, type Database } from './index';
import {
  bodyMetrics,
  nutritionLogs,
  syncLogs,
  userGoals,
  userProfiles,
  weeklyCoachReports,
  workoutLogs,
} from './schema';
import {
  createSeedDataset,
  DEFAULT_SUPPLEMENT_STACK,
  getLocalDateString,
  SEED_USER_ID,
} from './seed-data';
import { hashWebhookApiKey } from '../middleware/webhookAuth';
import {
  calculateAge,
  calculateBmr,
  calculateDynamicTdee,
  calculateMacroTargets,
  calculateTargetCalories,
  evaluateReadiness,
  getWeekdayKey,
  resolveCalorieCyclingForDate,
} from '../services/tdee.service';
import { computeBodyTrends } from '../services/trends.service';
import {
  computeWeeklyCoachMetrics,
  evaluateAdaptiveAdjustment,
  generateWeeklyCoachNarrative,
  getWeekBounds,
  type WeeklyCoachNarrativeFn,
} from '../services/weeklyCoach.service';

export interface ToggleSupplementResult {
  supplementKey: string;
  taken: boolean;
  loggedDate: string;
}

const DEFAULT_FALLBACK_WEIGHT_KG = 75;

const bangkokDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Formats a Date as YYYY-MM-DD in Asia/Bangkok (UTC+7) calendar time.
 */
export function getBangkokDateString(date: Date = new Date()): string {
  return bangkokDateFormatter.format(date);
}

function hashesMatchTimingSafe(
  storedHash: string | null | undefined,
  candidateHash: string,
): boolean {
  if (!storedHash || !candidateHash) {
    return false;
  }
  const storedBuf = Buffer.from(storedHash, 'utf8');
  const candidateBuf = Buffer.from(candidateHash, 'utf8');
  if (storedBuf.length !== candidateBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(storedBuf, candidateBuf);
}

function buildWebhookKeyStatus(
  prefix: string | null | undefined,
  hash: string | null | undefined,
): WebhookKeyStatusDTO {
  if (!hash || !prefix) {
    return {
      configured: false,
      masked_key: null,
      prefix: null,
    };
  }
  return {
    configured: true,
    masked_key: `${prefix}••••••••`,
    prefix,
  };
}

function collectAppleHealthUpdatedFields(
  payload: AppleHealthWebhookPayload,
): string[] {
  const fields: string[] = [];
  if (payload.weight_kg !== undefined) fields.push('weight_kg');
  if (payload.body_fat_pct !== undefined) fields.push('body_fat_pct');
  if (payload.skeletal_muscle_kg !== undefined) fields.push('skeletal_muscle_kg');
  if (payload.resting_hr !== undefined) fields.push('resting_hr');
  if (payload.sleep_hours !== undefined) fields.push('sleep_hours');
  if (payload.active_calories !== undefined) fields.push('active_calories');
  return fields;
}

function hasAppleHealthBodyMetricFields(
  payload: AppleHealthWebhookPayload,
): boolean {
  return (
    payload.weight_kg !== undefined ||
    payload.body_fat_pct !== undefined ||
    payload.skeletal_muscle_kg !== undefined ||
    payload.resting_hr !== undefined ||
    payload.sleep_hours !== undefined
  );
}

export type UpdateProfileSettingsRepoInput = Omit<
  UpdateProfileSettingsInput,
  'calorie_cycling'
> & {
  calorie_cycling?:
    | (Omit<
        CalorieCyclingConfig,
        'trainingDayOffset' | 'restDayOffset' | 'trainingDays'
      > & {
        trainingDayOffset?: number;
        restDayOffset?: number;
        trainingDays?: WeekdayKey[];
      })
    | null;
};

export interface HealthRepository {
  getStorageMode(): 'postgres' | 'memory';
  getMe(userId: string, email?: string | null): Promise<MeResponseDTO>;
  completeOnboarding(
    userId: string,
    input: OnboardingProfileInput,
    fallbackName?: string,
    email?: string | null,
  ): Promise<MeResponseDTO>;
  generateWebhookKey(userId: string): Promise<WebhookKeyResponse>;
  findUserIdByWebhookKeyHash(keyHash: string): Promise<string | null>;
  getTodayData(userId: string, date?: string): Promise<DashboardTodayResponse>;
  getTrends(userId: string, days: number): Promise<MetricsTrendsResponse>;
  createNutritionLog(
    userId: string,
    input: CreateNutritionLogInput,
  ): Promise<NutritionLogDTO>;
  createNutritionLogsBatch(
    userId: string,
    input: CreateBatchNutritionLogsInput,
  ): Promise<NutritionLogDTO[]>;
  deleteNutritionLog(userId: string, id: string): Promise<boolean>;
  createWorkoutLog(
    userId: string,
    input: CreateWorkoutLogInput,
  ): Promise<WorkoutLogDTO>;
  deleteWorkoutLog(userId: string, id: string): Promise<boolean>;
  toggleSupplement(
    userId: string,
    input: ToggleSupplementInput,
  ): Promise<ToggleSupplementResult>;
  createBodyMetric(
    userId: string,
    input: CreateBodyMetricInput,
  ): Promise<BodyMetricDTO>;
  syncAppleHealth(
    userId: string,
    payload: AppleHealthWebhookPayload,
  ): Promise<AppleHealthWebhookResponse>;
  getAppleHealthSyncStatus(userId: string): Promise<SyncStatusDTO>;
  updateSupplementStack(
    userId: string,
    supplements: SupplementConfig[],
  ): Promise<SupplementConfig[]>;
  updateProfileSettings(
    userId: string,
    input: UpdateProfileSettingsRepoInput,
    email?: string | null,
  ): Promise<MeResponseDTO>;
  getBootstrapData(
    userId: string,
    days: number,
    email?: string | null,
    date?: string,
  ): Promise<DashboardBootstrapResponse>;
  getMonthlyCalendar(userId: string, month?: string): Promise<MonthlyCalendarResponse>;
  getWeeklyCoachStatus(
    userId: string,
    weekStart?: string,
  ): Promise<WeeklyCoachStatusResponse>;
  generateWeeklyCoachReport(
    userId: string,
    options?: {
      weekStart?: string;
      force?: boolean;
      generateNarrative?: WeeklyCoachNarrativeFn;
    },
  ): Promise<WeeklyCoachReportDTO>;
  applyWeeklyCoachRecommendation(
    userId: string,
    reportId: string,
    email?: string | null,
  ): Promise<ApplyWeeklyCoachResponse>;
}

const WEEKDAY_SHORT_LABELS: Record<WeekdayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function cloneCalorieCycling(
  config:
    | (Omit<
        CalorieCyclingConfig,
        'trainingDayOffset' | 'restDayOffset' | 'trainingDays'
      > & {
        trainingDayOffset?: number;
        restDayOffset?: number;
        trainingDays?: WeekdayKey[];
      })
    | null
    | undefined,
): CalorieCyclingConfig | null {
  if (!config) {
    return null;
  }
  return {
    enabled: config.enabled,
    mode: config.mode,
    dayOffsets: { ...config.dayOffsets },
    trainingDayOffset: config.trainingDayOffset ?? 200,
    restDayOffset: config.restDayOffset ?? -150,
    trainingDays: config.trainingDays
      ? [...config.trainingDays]
      : ['mon', 'wed', 'fri', 'sat'],
  };
}

function cloneGoalDTO(goal: UserGoalDTO): UserGoalDTO {
  return {
    ...goal,
    calorieCycling: cloneCalorieCycling(goal.calorieCycling),
  };
}

function cloneWeeklyCoachReport(report: WeeklyCoachReportDTO): WeeklyCoachReportDTO {
  return {
    ...report,
    metrics: { ...report.metrics },
    recommendation: { ...report.recommendation },
    narrative: {
      ...report.narrative,
      wins: [...report.narrative.wins],
      bottlenecks: [...report.narrative.bottlenecks],
      actionPlan: [...report.narrative.actionPlan],
    },
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildMacroProgress(consumed: number, target: number): MacroProgress {
  const roundedConsumed = roundTo(consumed, 1);
  return {
    consumed: roundedConsumed,
    target,
    remaining: Math.max(0, roundTo(target - roundedConsumed, 1)),
    percentage: target > 0 ? Math.round((roundedConsumed / target) * 100) : 0,
  };
}

function buildWeeklyBudgetSummary(params: {
  targetDate: string;
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  metricsUpToWeekEnd: BodyMetricDTO[];
  earliestFallbackMetric: BodyMetricDTO | null;
  workoutsInWeek: WorkoutLogDTO[];
  nutritionInWeek: NutritionLogDTO[];
}): WeeklyBudgetSummaryDTO {
  const {
    targetDate,
    profile,
    goal,
    metricsUpToWeekEnd,
    earliestFallbackMetric,
    workoutsInWeek,
    nutritionInWeek,
  } = params;
  const { weekStartDate, weekEndDate, dates } = getWeekBounds(targetDate);

  const sortedMetrics = [...metricsUpToWeekEnd].sort((a, b) =>
    a.recordedDate.localeCompare(b.recordedDate),
  );

  const workoutsByDate = new Map<string, WorkoutLogDTO[]>();
  for (const workout of workoutsInWeek) {
    const list = workoutsByDate.get(workout.loggedDate);
    if (list) list.push(workout);
    else workoutsByDate.set(workout.loggedDate, [workout]);
  }

  const nutritionByDate = new Map<string, NutritionLogDTO[]>();
  for (const entry of nutritionInWeek) {
    const list = nutritionByDate.get(entry.loggedDate);
    if (list) list.push(entry);
    else nutritionByDate.set(entry.loggedDate, [entry]);
  }

  let carryForwardMetric: BodyMetricDTO | null = null;
  let metricPtr = 0;

  const days: WeeklyBudgetDayDTO[] = [];
  let weeklyTargetCalories = 0;
  let weeklyConsumedCalories = 0;
  let daysElapsed = 0;

  for (const dayDate of dates) {
    while (
      metricPtr < sortedMetrics.length &&
      sortedMetrics[metricPtr].recordedDate <= dayDate
    ) {
      carryForwardMetric = sortedMetrics[metricPtr];
      metricPtr++;
    }

    const referenceMetric = carryForwardMetric ?? earliestFallbackMetric;
    const refWeightKg = referenceMetric?.weightKg ?? DEFAULT_FALLBACK_WEIGHT_KG;
    const refBodyFatPct = referenceMetric?.bodyFatPct ?? null;

    const age = calculateAge(profile.birthDate, dayDate);
    const bmrResult = calculateBmr({
      weightKg: refWeightKg,
      heightCm: profile.heightCm,
      age,
      sex: profile.sex,
      bodyFatPct: refBodyFatPct,
    });

    const dayWorkouts = workoutsByDate.get(dayDate) ?? [];
    const activeCalories = Math.round(
      dayWorkouts.reduce((sum, w) => sum + w.activeCalories, 0),
    );
    const { dynamicTdee } = calculateDynamicTdee({
      bmr: bmrResult.bmr,
      baselineActivityMultiplier: profile.baselineActivityMultiplier,
      activeCalories,
    });

    const cycling = resolveCalorieCyclingForDate(
      goal.calorieCycling,
      dayDate,
      dayWorkouts.length > 0,
    );
    const targetCalories = calculateTargetCalories({
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
      cyclingOffset: cycling.offset,
    });

    const dayMeals = (nutritionByDate.get(dayDate) ?? []).filter(
      (item) => item.mealType !== 'supplement',
    );
    const consumedCalories = Math.round(
      dayMeals.reduce((sum, m) => sum + m.calories, 0),
    );

    const weekday = getWeekdayKey(dayDate);
    const isToday = dayDate === targetDate;
    const isFuture = dayDate > targetDate;
    if (!isFuture) {
      daysElapsed++;
    }

    weeklyTargetCalories += targetCalories;
    weeklyConsumedCalories += consumedCalories;

    days.push({
      date: dayDate,
      weekday,
      dayLabel: WEEKDAY_SHORT_LABELS[weekday],
      dayType: cycling.dayType,
      cyclingOffset: cycling.offset,
      targetCalories,
      consumedCalories,
      isToday,
      isFuture,
    });
  }

  const cyclingEnabled = Boolean(
    goal.calorieCycling?.enabled && goal.calorieCycling.mode !== 'NONE',
  );
  const cyclingMode: CalorieCyclingMode =
    cyclingEnabled && goal.calorieCycling ? goal.calorieCycling.mode : 'NONE';

  return {
    weekStartDate,
    weekEndDate,
    weeklyTargetCalories,
    weeklyConsumedCalories,
    weeklyRemainingCalories: weeklyTargetCalories - weeklyConsumedCalories,
    daysElapsed,
    cyclingEnabled,
    cyclingMode,
    days,
  };
}

function buildDashboardTodayResponse(params: {
  date: string;
  storageMode: 'postgres' | 'memory';
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  latestMetric: BodyMetricDTO;
  workouts: WorkoutLogDTO[];
  nutritionForDate: NutritionLogDTO[];
  weeklyBudget?: WeeklyBudgetSummaryDTO;
}): DashboardTodayResponse {
  const {
    date,
    storageMode,
    profile,
    goal,
    latestMetric,
    workouts,
    nutritionForDate,
    weeklyBudget,
  } = params;

  const age = calculateAge(profile.birthDate, date);
  const profileWithAge: UserProfileDTO = { ...profile, age };

  const bmrResult = calculateBmr({
    weightKg: latestMetric.weightKg,
    heightCm: profile.heightCm,
    age,
    sex: profile.sex,
    bodyFatPct: latestMetric.bodyFatPct,
  });

  const activeCalories = Math.round(
    workouts.reduce((sum, w) => sum + w.activeCalories, 0),
  );

  const { baselineTdee, dynamicTdee } = calculateDynamicTdee({
    bmr: bmrResult.bmr,
    baselineActivityMultiplier: profile.baselineActivityMultiplier,
    activeCalories,
  });

  const cycling = resolveCalorieCyclingForDate(
    goal.calorieCycling,
    date,
    workouts.length > 0,
  );
  const baseTargetCalories = calculateTargetCalories({
    dynamicTdee,
    calorieAdjustment: goal.calorieAdjustment,
  });
  const targetCalories = calculateTargetCalories({
    dynamicTdee,
    calorieAdjustment: goal.calorieAdjustment,
    cyclingOffset: cycling.offset,
  });

  const macroTargets = calculateMacroTargets({
    targetCalories,
    baseTargetCaloriesForFat: baseTargetCalories,
    weightKg: latestMetric.weightKg,
    proteinPerKg: goal.proteinPerKg,
    fatRatio: goal.fatRatio,
  });

  const meals = nutritionForDate.filter((item) => item.mealType !== 'supplement');
  const takenKeys = new Set(
    nutritionForDate
      .filter((item) => item.mealType === 'supplement' && item.supplementKey)
      .map((item) => item.supplementKey as string),
  );

  const consumedCalories = Math.round(
    meals.reduce((sum, m) => sum + m.calories, 0),
  );
  const consumedProteinG = meals.reduce((sum, m) => sum + m.proteinG, 0);
  const consumedCarbsG = meals.reduce((sum, m) => sum + m.carbsG, 0);
  const consumedFatG = meals.reduce((sum, m) => sum + m.fatG, 0);

  const readiness = evaluateReadiness({
    consumedCalories,
    targetCalories,
    consumedProteinG,
    targetProteinG: macroTargets.proteinG,
    activeCalories,
    goalType: goal.goalType,
  });

  const supplements: SupplementStatusDTO[] = profile.supplementStack.map((supp) => ({
    ...supp,
    taken: takenKeys.has(supp.key),
  }));

  return {
    date,
    storageMode,
    profile: profileWithAge,
    goal,
    latestMetric,
    energy: {
      bmr: bmrResult.bmr,
      bmrFormula: bmrResult.formula,
      leanBodyMassKg: bmrResult.leanBodyMassKg,
      baselineTdee,
      activeCalories,
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
      cyclingOffset: cycling.offset,
      cyclingDayType: cycling.dayType,
      cyclingLabel: cycling.label,
      targetCalories,
      consumedCalories,
      remainingCalories: Math.round(targetCalories - consumedCalories),
      intakePercentage:
        targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0,
    },
    macros: {
      protein: buildMacroProgress(consumedProteinG, macroTargets.proteinG),
      carbs: buildMacroProgress(consumedCarbsG, macroTargets.carbsG),
      fat: buildMacroProgress(consumedFatG, macroTargets.fatG),
    },
    readiness,
    workouts,
    meals,
    supplements,
    ...(weeklyBudget ? { weeklyBudget } : {}),
  };
}

function selectLatestMetric(
  metrics: BodyMetricDTO[],
  targetDate: string,
): BodyMetricDTO {
  const eligible = metrics.filter((m) => m.recordedDate <= targetDate);
  const pool = eligible.length > 0 ? eligible : metrics;
  if (pool.length === 0) {
    throw new HTTPException(404, {
      message: 'No body metrics found for user. Complete onboarding first.',
    });
  }

  let latest = pool[pool.length - 1];
  for (const metric of pool) {
    if (metric.recordedDate >= latest.recordedDate) {
      latest = metric;
    }
  }
  return latest;
}

function buildSyncStatus(
  latestSync:
    | { syncedAt: Date; payloadSummary: { synced_fields?: string[] } }
    | null
    | undefined,
): SyncStatusDTO {
  if (!latestSync) {
    return {
      status: 'NEVER',
      last_synced_at: null,
      synced_fields: [],
    };
  }

  return {
    status: 'SUCCESS',
    last_synced_at: latestSync.syncedAt.toISOString(),
    synced_fields: [...(latestSync.payloadSummary.synced_fields ?? [])],
  };
}

function getMonthBounds(month?: string): {
  resolvedMonth: string;
  daysInMonth: number;
  monthStart: string;
  monthEnd: string;
  today: string;
} {
  const today = getBangkokDateString();
  const resolvedMonth = month ?? today.slice(0, 7);
  const [yearNum, monthNum] = resolvedMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const monthStart = `${resolvedMonth}-01`;
  const monthEnd = `${resolvedMonth}-${String(daysInMonth).padStart(2, '0')}`;
  return { resolvedMonth, daysInMonth, monthStart, monthEnd, today };
}

function buildMonthlyCalendarResponse(params: {
  month: string;
  daysInMonth: number;
  today: string;
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  metricsUpToMonthEnd: BodyMetricDTO[];
  earliestFallbackMetric: BodyMetricDTO | null;
  workoutsInMonth: WorkoutLogDTO[];
  nutritionInMonth: NutritionLogDTO[];
}): MonthlyCalendarResponse {
  const {
    month,
    daysInMonth,
    today,
    profile,
    goal,
    metricsUpToMonthEnd,
    earliestFallbackMetric,
    workoutsInMonth,
    nutritionInMonth,
  } = params;

  const sortedMetrics = [...metricsUpToMonthEnd].sort((a, b) =>
    a.recordedDate.localeCompare(b.recordedDate),
  );
  const metricByDate = new Map<string, BodyMetricDTO>();
  for (const metric of sortedMetrics) {
    metricByDate.set(metric.recordedDate, metric);
  }

  const workoutsByDate = new Map<string, WorkoutLogDTO[]>();
  for (const workout of workoutsInMonth) {
    const list = workoutsByDate.get(workout.loggedDate);
    if (list) {
      list.push(workout);
    } else {
      workoutsByDate.set(workout.loggedDate, [workout]);
    }
  }

  const nutritionByDate = new Map<string, NutritionLogDTO[]>();
  for (const entry of nutritionInMonth) {
    const list = nutritionByDate.get(entry.loggedDate);
    if (list) {
      list.push(entry);
    } else {
      nutritionByDate.set(entry.loggedDate, [entry]);
    }
  }

  const supplementsTotal = profile.supplementStack.length;
  const days: CalendarDaySummaryDTO[] = [];
  let carryForwardMetric: BodyMetricDTO | null = null;
  let metricPtr = 0;

  let loggedDays = 0;
  let optimalDays = 0;
  let moderateDays = 0;
  let overloadDays = 0;
  let mealDaysCount = 0;
  let mealDaysCaloriesSum = 0;
  let mealDaysProteinSum = 0;
  let totalActiveCalories = 0;
  let weighedDaysCount = 0;
  let weighedDaysSum = 0;
  let totalSupplementsTaken = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = `${month}-${String(day).padStart(2, '0')}`;
    while (
      metricPtr < sortedMetrics.length &&
      sortedMetrics[metricPtr].recordedDate <= dayDate
    ) {
      carryForwardMetric = sortedMetrics[metricPtr];
      metricPtr++;
    }

    const dayMetric = metricByDate.get(dayDate) ?? null;
    const referenceMetric = carryForwardMetric ?? earliestFallbackMetric;
    const refWeightKg = referenceMetric?.weightKg ?? DEFAULT_FALLBACK_WEIGHT_KG;
    const refBodyFatPct = referenceMetric?.bodyFatPct ?? null;

    const age = calculateAge(profile.birthDate, dayDate);
    const bmrResult = calculateBmr({
      weightKg: refWeightKg,
      heightCm: profile.heightCm,
      age,
      sex: profile.sex,
      bodyFatPct: refBodyFatPct,
    });

    const dayWorkouts = workoutsByDate.get(dayDate) ?? [];
    const workoutCount = dayWorkouts.length;
    const activeCalories = Math.round(
      dayWorkouts.reduce((sum, w) => sum + w.activeCalories, 0),
    );

    const { dynamicTdee } = calculateDynamicTdee({
      bmr: bmrResult.bmr,
      baselineActivityMultiplier: profile.baselineActivityMultiplier,
      activeCalories,
    });
    const cycling = resolveCalorieCyclingForDate(
      goal.calorieCycling,
      dayDate,
      dayWorkouts.length > 0,
    );
    const baseTargetCalories = calculateTargetCalories({
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
    });
    const targetCalories = calculateTargetCalories({
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
      cyclingOffset: cycling.offset,
    });
    const macroTargets = calculateMacroTargets({
      targetCalories,
      baseTargetCaloriesForFat: baseTargetCalories,
      weightKg: refWeightKg,
      proteinPerKg: goal.proteinPerKg,
      fatRatio: goal.fatRatio,
    });

    const dayNutrition = nutritionByDate.get(dayDate) ?? [];
    const meals = dayNutrition.filter((item) => item.mealType !== 'supplement');
    const mealCount = meals.length;
    const consumedCalories = Math.round(
      meals.reduce((sum, m) => sum + m.calories, 0),
    );
    const proteinG = roundTo(
      meals.reduce((sum, m) => sum + m.proteinG, 0),
      1,
    );
    const carbsG = roundTo(
      meals.reduce((sum, m) => sum + m.carbsG, 0),
      1,
    );
    const fatG = roundTo(
      meals.reduce((sum, m) => sum + m.fatG, 0),
      1,
    );

    const supplementsTaken = new Set(
      dayNutrition
        .filter((item) => item.mealType === 'supplement' && item.supplementKey)
        .map((item) => item.supplementKey as string),
    ).size;

    const hasData =
      mealCount > 0 || workoutCount > 0 || supplementsTaken > 0 || dayMetric !== null;
    const status: CalendarDayStatus = !hasData
      ? 'empty'
      : evaluateReadiness({
          consumedCalories,
          targetCalories,
          consumedProteinG: proteinG,
          targetProteinG: macroTargets.proteinG,
          activeCalories,
          goalType: goal.goalType,
        }).status;

    if (hasData) {
      loggedDays++;
      if (status === 'optimal') optimalDays++;
      else if (status === 'moderate') moderateDays++;
      else if (status === 'overload') overloadDays++;
    }
    if (mealCount > 0 || consumedCalories > 0) {
      mealDaysCount++;
      mealDaysCaloriesSum += consumedCalories;
      mealDaysProteinSum += proteinG;
    }
    totalActiveCalories += activeCalories;
    totalSupplementsTaken += supplementsTaken;

    const weightKg = dayMetric ? dayMetric.weightKg : null;
    if (weightKg !== null) {
      weighedDaysCount++;
      weighedDaysSum += weightKg;
    }

    days.push({
      date: dayDate,
      hasData,
      status,
      consumedCalories,
      targetCalories,
      dynamicTdee,
      activeCalories,
      proteinG,
      proteinTargetG: macroTargets.proteinG,
      carbsG,
      fatG,
      mealCount,
      workoutCount,
      supplementsTaken,
      supplementsTotal,
      weightKg,
      bodyFatPct: dayMetric ? dayMetric.bodyFatPct : null,
      sleepHours: dayMetric ? (dayMetric.sleepHours ?? null) : null,
      restingHr: dayMetric ? (dayMetric.restingHr ?? null) : null,
    });
  }

  const summary: MonthlyCalendarSummaryDTO = {
    loggedDays,
    optimalDays,
    moderateDays,
    overloadDays,
    avgCalories: mealDaysCount > 0 ? Math.round(mealDaysCaloriesSum / mealDaysCount) : 0,
    avgProteinG:
      mealDaysCount > 0 ? roundTo(mealDaysProteinSum / mealDaysCount, 1) : 0,
    totalActiveCalories: Math.round(totalActiveCalories),
    avgWeightKg:
      weighedDaysCount > 0 ? roundTo(weighedDaysSum / weighedDaysCount, 2) : null,
    supplementAdherencePct:
      loggedDays > 0 && supplementsTotal > 0
        ? Math.min(
            100,
            Math.round((totalSupplementsTaken / (loggedDays * supplementsTotal)) * 100),
          )
        : 0,
  };

  return {
    month,
    daysInMonth,
    today,
    days,
    summary,
  };
}

interface InMemorySyncLogRecord {
  id: string;
  userId: string;
  source: string;
  payloadSummary: { recorded_date: string; synced_fields: string[] };
  syncedAt: Date;
}

interface InMemoryUserRecord {
  profile: UserProfileDTO;
  webhookKeyHash: string | null;
  webhookKeyPrefix: string | null;
  goals: UserGoalDTO[];
  metrics: BodyMetricDTO[];
  workouts: WorkoutLogDTO[];
  nutrition: NutritionLogDTO[];
  syncLogs: InMemorySyncLogRecord[];
  coachReports: WeeklyCoachReportDTO[];
}

export class InMemoryHealthRepository implements HealthRepository {
  private readonly users = new Map<string, InMemoryUserRecord>();

  constructor(todayDate: string = getLocalDateString()) {
    const seed = createSeedDataset(todayDate);
    this.users.set(seed.profile.id, {
      profile: {
        ...seed.profile,
        webhookKeyPrefix: null,
        supplementStack: seed.profile.supplementStack.map((s) => ({ ...s })),
      },
      webhookKeyHash: null,
      webhookKeyPrefix: null,
      goals: [
        {
          ...seed.goal,
          calorieCycling: cloneCalorieCycling(seed.goal.calorieCycling),
        },
      ],
      metrics: seed.bodyMetrics.map((m) => ({
        ...m,
        restingHr: m.restingHr ?? null,
        sleepHours: m.sleepHours ?? null,
      })),
      workouts: seed.workoutLogs.map((w) => ({
        ...w,
        activityType: w.activityType ?? 'MANUAL',
      })),
      nutrition: seed.nutritionLogs.map((n) => ({
        ...n,
        source: n.source ?? 'MANUAL',
      })),
      syncLogs: [],
      coachReports: [],
    });
  }

  getStorageMode(): 'postgres' | 'memory' {
    return 'memory';
  }

  private requireUser(userId: string): InMemoryUserRecord {
    const user = this.users.get(userId);
    if (!user) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }
    return user;
  }

  private findLatestKnownWeight(user: InMemoryUserRecord, targetDate: string): number {
    const eligible = user.metrics.filter((m) => m.recordedDate <= targetDate);
    const pool = eligible.length > 0 ? eligible : user.metrics;
    if (pool.length === 0) {
      return DEFAULT_FALLBACK_WEIGHT_KG;
    }

    let latest = pool[pool.length - 1];
    for (const metric of pool) {
      if (metric.recordedDate >= latest.recordedDate) {
        latest = metric;
      }
    }
    return latest.weightKg;
  }

  async getMe(userId: string, email?: string | null): Promise<MeResponseDTO> {
    const user = this.users.get(userId);
    const activeGoal = user?.goals.find((g) => g.isActive) ?? null;

    if (!user || !activeGoal) {
      return {
        userId,
        email: email ?? null,
        onboarded: false,
        profile: null,
        goal: null,
        webhookKey: {
          configured: false,
          masked_key: null,
          prefix: null,
        },
      };
    }

    return {
      userId,
      email: email ?? null,
      onboarded: true,
      profile: {
        ...user.profile,
        age: calculateAge(user.profile.birthDate),
        webhookKeyPrefix: user.webhookKeyPrefix,
        supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
      },
      goal: cloneGoalDTO(activeGoal),
      webhookKey: buildWebhookKeyStatus(user.webhookKeyPrefix, user.webhookKeyHash),
    };
  }

  async completeOnboarding(
    userId: string,
    input: OnboardingProfileInput,
    fallbackName?: string,
    email?: string | null,
  ): Promise<MeResponseDTO> {
    const recordedDate = getBangkokDateString();
    const resolvedName = input.name?.trim() || fallbackName?.trim() || 'Athlete';
    const existing = this.users.get(userId);

    const profile: UserProfileDTO = {
      id: userId,
      name: resolvedName,
      sex: input.gender,
      birthDate: input.birth_date,
      age: calculateAge(input.birth_date),
      heightCm: input.height_cm,
      baselineActivityMultiplier: input.baseline_activity_multiplier,
      supplementStack: DEFAULT_SUPPLEMENT_STACK.map((s) => ({ ...s })),
      webhookKeyPrefix: existing?.webhookKeyPrefix ?? null,
    };

    const deactivatedGoals =
      existing?.goals.map((g) => ({ ...g, isActive: false })) ?? [];
    const newGoal: UserGoalDTO = {
      id: `goal-${crypto.randomUUID()}`,
      userId,
      goalType: input.goal_type,
      calorieAdjustment: input.calorie_adjustment,
      proteinPerKg: input.protein_per_kg,
      fatRatio: input.fat_ratio,
      isActive: true,
      calorieCycling: null,
    };

    const userRecord: InMemoryUserRecord = existing ?? {
      profile,
      webhookKeyHash: null,
      webhookKeyPrefix: null,
      goals: [],
      metrics: [],
      workouts: [],
      nutrition: [],
      syncLogs: [],
      coachReports: [],
    };

    userRecord.profile = profile;
    userRecord.goals = [...deactivatedGoals, newGoal];

    const existingMetric = userRecord.metrics.find(
      (m) => m.userId === userId && m.recordedDate === recordedDate,
    );
    if (existingMetric) {
      existingMetric.weightKg = input.weight_kg;
      existingMetric.bodyFatPct = input.body_fat_pct ?? null;
      existingMetric.skeletalMuscleMassKg = input.skeletal_muscle_kg ?? null;
      existingMetric.notes = 'Initial onboarding baseline';
    } else {
      userRecord.metrics.push({
        id: `metric-${crypto.randomUUID()}`,
        userId,
        recordedDate,
        weightKg: input.weight_kg,
        bodyFatPct: input.body_fat_pct ?? null,
        skeletalMuscleMassKg: input.skeletal_muscle_kg ?? null,
        restingHr: null,
        sleepHours: null,
        notes: 'Initial onboarding baseline',
      });
    }

    this.users.set(userId, userRecord);
    return this.getMe(userId, email);
  }

  async generateWebhookKey(userId: string): Promise<WebhookKeyResponse> {
    const user = this.requireUser(userId);
    const apiKey = `hk_live_${crypto.randomBytes(24).toString('hex')}`;
    const hash = hashWebhookApiKey(apiKey);
    const prefix = apiKey.slice(0, 12);
    const maskedKey = `${prefix}••••••••`;

    user.webhookKeyHash = hash;
    user.webhookKeyPrefix = prefix;
    user.profile.webhookKeyPrefix = prefix;

    return {
      api_key: apiKey,
      masked_key: maskedKey,
      created_at: new Date().toISOString(),
    };
  }

  async findUserIdByWebhookKeyHash(keyHash: string): Promise<string | null> {
    let matchedUserId: string | null = null;
    for (const [userId, user] of this.users.entries()) {
      if (hashesMatchTimingSafe(user.webhookKeyHash, keyHash)) {
        matchedUserId = userId;
      }
    }
    return matchedUserId;
  }

  async getTodayData(userId: string, date?: string): Promise<DashboardTodayResponse> {
    const user = this.requireUser(userId);
    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    const targetDate = date ?? getLocalDateString();
    const { weekStartDate, weekEndDate } = getWeekBounds(targetDate);
    const allUserMetrics = [...user.metrics]
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));
    const latestMetric = selectLatestMetric(allUserMetrics, targetDate);

    const metricsUpToWeekEnd = allUserMetrics.filter(
      (m) => m.recordedDate <= weekEndDate,
    );
    const earliestFallbackMetric = allUserMetrics[0] ?? null;

    const workoutsInWeek = user.workouts
      .filter(
        (w) =>
          w.userId === userId &&
          w.loggedDate >= weekStartDate &&
          w.loggedDate <= weekEndDate,
      )
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
      .map((w) => ({ ...w, activityType: w.activityType ?? 'MANUAL' }));
    const nutritionInWeek = user.nutrition
      .filter(
        (n) =>
          n.userId === userId &&
          n.loggedDate >= weekStartDate &&
          n.loggedDate <= weekEndDate,
      )
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

    const workouts = workoutsInWeek.filter((w) => w.loggedDate === targetDate);
    const nutritionForDate = nutritionInWeek.filter((n) => n.loggedDate === targetDate);

    const profileDTO: UserProfileDTO = {
      ...user.profile,
      webhookKeyPrefix: user.webhookKeyPrefix,
      supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
    };
    const goalDTO = cloneGoalDTO(activeGoal);
    const weeklyBudget = buildWeeklyBudgetSummary({
      targetDate,
      profile: profileDTO,
      goal: goalDTO,
      metricsUpToWeekEnd,
      earliestFallbackMetric,
      workoutsInWeek,
      nutritionInWeek,
    });

    return buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'memory',
      profile: profileDTO,
      goal: goalDTO,
      latestMetric: {
        ...latestMetric,
        restingHr: latestMetric.restingHr ?? null,
        sleepHours: latestMetric.sleepHours ?? null,
      },
      workouts,
      nutritionForDate,
      weeklyBudget,
    });
  }

  async getTrends(userId: string, days: number): Promise<MetricsTrendsResponse> {
    const user = this.users.get(userId);
    const metrics = user ? user.metrics.filter((m) => m.userId === userId) : [];
    return computeBodyTrends(metrics, days);
  }

  async createNutritionLog(
    userId: string,
    input: CreateNutritionLogInput,
  ): Promise<NutritionLogDTO> {
    const user = this.requireUser(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();
    const record: NutritionLogDTO = {
      id: `nutrition-${crypto.randomUUID()}`,
      userId,
      loggedDate,
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
    user.nutrition.push(record);
    return { ...record };
  }

  async createNutritionLogsBatch(
    userId: string,
    input: CreateBatchNutritionLogsInput,
  ): Promise<NutritionLogDTO[]> {
    const user = this.requireUser(userId);
    if (input.items.length === 0) {
      return [];
    }

    const defaultDate = getLocalDateString();
    const baseTimeMs = Date.now();
    const created: NutritionLogDTO[] = input.items.map((item, idx) => ({
      id: `nutrition-${crypto.randomUUID()}`,
      userId,
      loggedDate: item.loggedDate ?? defaultDate,
      mealType: item.mealType,
      itemName: item.itemName,
      calories: item.calories,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
      supplementKey: null,
      source: input.source,
      loggedAt: new Date(baseTimeMs + idx).toISOString(),
    }));
    user.nutrition.push(...created);
    return created.map((record) => ({ ...record }));
  }

  async deleteNutritionLog(userId: string, id: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }
    const idx = user.nutrition.findIndex((n) => n.id === id && n.userId === userId);
    if (idx === -1) {
      return false;
    }
    user.nutrition.splice(idx, 1);
    return true;
  }

  async createWorkoutLog(
    userId: string,
    input: CreateWorkoutLogInput,
  ): Promise<WorkoutLogDTO> {
    const user = this.requireUser(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();
    const record: WorkoutLogDTO = {
      id: `workout-${crypto.randomUUID()}`,
      userId,
      loggedDate,
      activityName: input.activityName,
      category: input.category,
      durationMin: input.durationMin,
      activeCalories: input.activeCalories,
      intensity: input.intensity,
      activityType: 'MANUAL',
      loggedAt: new Date().toISOString(),
    };
    user.workouts.push(record);
    return { ...record };
  }

  async deleteWorkoutLog(userId: string, id: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }
    const idx = user.workouts.findIndex((w) => w.id === id && w.userId === userId);
    if (idx === -1) {
      return false;
    }
    user.workouts.splice(idx, 1);
    return true;
  }

  async toggleSupplement(
    userId: string,
    input: ToggleSupplementInput,
  ): Promise<ToggleSupplementResult> {
    const user = this.requireUser(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();
    const existingIndex = user.nutrition.findIndex(
      (n) =>
        n.userId === userId &&
        n.loggedDate === loggedDate &&
        n.mealType === 'supplement' &&
        n.supplementKey === input.supplementKey,
    );

    if (existingIndex !== -1) {
      user.nutrition = user.nutrition.filter(
        (n) =>
          !(
            n.userId === userId &&
            n.loggedDate === loggedDate &&
            n.mealType === 'supplement' &&
            n.supplementKey === input.supplementKey
          ),
      );
      return { supplementKey: input.supplementKey, taken: false, loggedDate };
    }

    const suppConfig = user.profile.supplementStack.find(
      (s) => s.key === input.supplementKey,
    );
    user.nutrition.push({
      id: `supp-${crypto.randomUUID()}`,
      userId,
      loggedDate,
      mealType: 'supplement',
      itemName: suppConfig?.name ?? input.supplementKey,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      supplementKey: input.supplementKey,
      source: 'MANUAL',
      loggedAt: new Date().toISOString(),
    });
    return { supplementKey: input.supplementKey, taken: true, loggedDate };
  }

  async createBodyMetric(
    userId: string,
    input: CreateBodyMetricInput,
  ): Promise<BodyMetricDTO> {
    const user = this.requireUser(userId);
    const recordedDate = input.recordedDate ?? getLocalDateString();
    const existing = user.metrics.find(
      (m) => m.userId === userId && m.recordedDate === recordedDate,
    );

    if (existing) {
      existing.weightKg = input.weightKg;
      if (input.bodyFatPct !== undefined) {
        existing.bodyFatPct = input.bodyFatPct;
      }
      if (input.skeletalMuscleMassKg !== undefined) {
        existing.skeletalMuscleMassKg = input.skeletalMuscleMassKg;
      }
      if (input.notes !== undefined) {
        existing.notes = input.notes;
      }
      return { ...existing };
    }

    const record: BodyMetricDTO = {
      id: `metric-${crypto.randomUUID()}`,
      userId,
      recordedDate,
      weightKg: input.weightKg,
      bodyFatPct: input.bodyFatPct ?? null,
      skeletalMuscleMassKg: input.skeletalMuscleMassKg ?? null,
      restingHr: null,
      sleepHours: null,
      notes: input.notes ?? null,
    };
    user.metrics.push(record);
    return { ...record };
  }

  async syncAppleHealth(
    userId: string,
    payload: AppleHealthWebhookPayload,
  ): Promise<AppleHealthWebhookResponse> {
    const user = this.requireUser(userId);
    const recordedDate = payload.recorded_date ?? getBangkokDateString();
    const updatedFields = collectAppleHealthUpdatedFields(payload);

    if (hasAppleHealthBodyMetricFields(payload)) {
      const existingMetric = user.metrics.find(
        (m) => m.userId === userId && m.recordedDate === recordedDate,
      );

      if (existingMetric) {
        if (payload.weight_kg !== undefined) {
          existingMetric.weightKg = payload.weight_kg;
        }
        if (payload.body_fat_pct !== undefined) {
          existingMetric.bodyFatPct = payload.body_fat_pct;
        }
        if (payload.skeletal_muscle_kg !== undefined) {
          existingMetric.skeletalMuscleMassKg = payload.skeletal_muscle_kg;
        }
        if (payload.resting_hr !== undefined) {
          existingMetric.restingHr = payload.resting_hr;
        }
        if (payload.sleep_hours !== undefined) {
          existingMetric.sleepHours = payload.sleep_hours;
        }
      } else {
        const fallbackWeightKg = this.findLatestKnownWeight(user, recordedDate);
        user.metrics.push({
          id: `metric-${crypto.randomUUID()}`,
          userId,
          recordedDate,
          weightKg: payload.weight_kg ?? fallbackWeightKg,
          bodyFatPct: payload.body_fat_pct ?? null,
          skeletalMuscleMassKg: payload.skeletal_muscle_kg ?? null,
          restingHr: payload.resting_hr ?? null,
          sleepHours: payload.sleep_hours ?? null,
          notes: null,
        });
      }
    }

    if (payload.active_calories !== undefined) {
      const existingHealthWorkout = user.workouts.find(
        (w) =>
          w.userId === userId &&
          w.loggedDate === recordedDate &&
          w.activityType === 'APPLE_HEALTH_SYNC',
      );

      if (existingHealthWorkout) {
        existingHealthWorkout.activeCalories = payload.active_calories;
        existingHealthWorkout.loggedAt = new Date().toISOString();
      } else {
        user.workouts.push({
          id: `workout-${crypto.randomUUID()}`,
          userId,
          loggedDate: recordedDate,
          activityName: 'Apple Health Active Energy',
          category: 'cardio',
          durationMin: 0,
          activeCalories: payload.active_calories,
          intensity: 'moderate',
          activityType: 'APPLE_HEALTH_SYNC',
          loggedAt: new Date().toISOString(),
        });
      }
    }

    const syncedAt = new Date();
    user.syncLogs.push({
      id: `sync-${crypto.randomUUID()}`,
      userId,
      source: 'APPLE_HEALTH',
      payloadSummary: {
        recorded_date: recordedDate,
        synced_fields: updatedFields,
      },
      syncedAt,
    });

    const dashboard = await this.getTodayData(userId, recordedDate);
    return {
      ok: true,
      recorded_date: recordedDate,
      updated_fields: updatedFields,
      dynamic_tdee: dashboard.energy.dynamicTdee,
      target_calories: dashboard.energy.targetCalories,
      synced_at: syncedAt.toISOString(),
    };
  }

  async getAppleHealthSyncStatus(userId: string): Promise<SyncStatusDTO> {
    const user = this.users.get(userId);
    const logs = user
      ? user.syncLogs.filter(
          (entry) => entry.userId === userId && entry.source === 'APPLE_HEALTH',
        )
      : [];

    if (logs.length === 0) {
      return {
        status: 'NEVER',
        last_synced_at: null,
        synced_fields: [],
      };
    }

    let latest = logs[0];
    for (const entry of logs) {
      if (entry.syncedAt.getTime() >= latest.syncedAt.getTime()) {
        latest = entry;
      }
    }

    return {
      status: 'SUCCESS',
      last_synced_at: latest.syncedAt.toISOString(),
      synced_fields: [...latest.payloadSummary.synced_fields],
    };
  }

  async updateSupplementStack(
    userId: string,
    supplements: SupplementConfig[],
  ): Promise<SupplementConfig[]> {
    const user = this.requireUser(userId);
    user.profile.supplementStack = supplements.map((s) => ({ ...s }));
    return user.profile.supplementStack.map((s) => ({ ...s }));
  }

  async updateProfileSettings(
    userId: string,
    input: UpdateProfileSettingsRepoInput,
    email?: string | null,
  ): Promise<MeResponseDTO> {
    const user = this.requireUser(userId);
    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    user.profile.name = input.name.trim();
    user.profile.sex = input.gender;
    user.profile.birthDate = input.birth_date;
    user.profile.age = calculateAge(input.birth_date);
    user.profile.heightCm = input.height_cm;
    user.profile.baselineActivityMultiplier = input.baseline_activity_multiplier;

    activeGoal.goalType = input.goal_type;
    activeGoal.calorieAdjustment = input.calorie_adjustment;
    activeGoal.proteinPerKg = input.protein_per_kg;
    activeGoal.fatRatio = input.fat_ratio;
    if (input.calorie_cycling !== undefined) {
      activeGoal.calorieCycling = cloneCalorieCycling(input.calorie_cycling);
    }

    return this.getMe(userId, email);
  }

  async getBootstrapData(
    userId: string,
    days: number,
    email?: string | null,
    date?: string,
  ): Promise<DashboardBootstrapResponse> {
    const targetDate = date ?? getLocalDateString();
    const { weekStartDate, weekEndDate } = getWeekBounds(targetDate);
    const user = this.users.get(userId);
    const activeGoal = user?.goals.find((g) => g.isActive) ?? null;
    const syncStatus = await this.getAppleHealthSyncStatus(userId);
    const webhookKey = user
      ? buildWebhookKeyStatus(user.webhookKeyPrefix, user.webhookKeyHash)
      : { configured: false, masked_key: null, prefix: null };

    if (!user || !activeGoal) {
      return {
        me: {
          userId,
          email: email ?? null,
          onboarded: false,
          profile: null,
          goal: null,
          webhookKey,
        },
        dashboard: null,
        trends: null,
        syncStatus,
      };
    }

    const allMetrics = [...user.metrics]
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));
    const latestMetric = selectLatestMetric(allMetrics, targetDate);
    const metricsUpToWeekEnd = allMetrics.filter((m) => m.recordedDate <= weekEndDate);
    const earliestFallbackMetric = allMetrics[0] ?? null;

    const profileDTO: UserProfileDTO = {
      ...user.profile,
      age: calculateAge(user.profile.birthDate),
      webhookKeyPrefix: user.webhookKeyPrefix,
      supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
    };
    const goalDTO = cloneGoalDTO(activeGoal);
    const me: MeResponseDTO = {
      userId,
      email: email ?? null,
      onboarded: true,
      profile: profileDTO,
      goal: goalDTO,
      webhookKey,
    };

    const workoutsInWeek = user.workouts
      .filter(
        (w) =>
          w.userId === userId &&
          w.loggedDate >= weekStartDate &&
          w.loggedDate <= weekEndDate,
      )
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
      .map((w) => ({ ...w, activityType: w.activityType ?? 'MANUAL' }));
    const nutritionInWeek = user.nutrition
      .filter(
        (n) =>
          n.userId === userId &&
          n.loggedDate >= weekStartDate &&
          n.loggedDate <= weekEndDate,
      )
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

    const workouts = workoutsInWeek.filter((w) => w.loggedDate === targetDate);
    const nutritionForDate = nutritionInWeek.filter((n) => n.loggedDate === targetDate);

    const weeklyBudget = buildWeeklyBudgetSummary({
      targetDate,
      profile: profileDTO,
      goal: goalDTO,
      metricsUpToWeekEnd,
      earliestFallbackMetric,
      workoutsInWeek,
      nutritionInWeek,
    });

    const dashboard = buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'memory',
      profile: profileDTO,
      goal: goalDTO,
      latestMetric: {
        ...latestMetric,
        restingHr: latestMetric.restingHr ?? null,
        sleepHours: latestMetric.sleepHours ?? null,
      },
      workouts,
      nutritionForDate,
      weeklyBudget,
    });

    const trends = computeBodyTrends(allMetrics, days);

    return { me, dashboard, trends, syncStatus };
  }

  async getMonthlyCalendar(
    userId: string,
    month?: string,
  ): Promise<MonthlyCalendarResponse> {
    const user = this.requireUser(userId);
    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    const { resolvedMonth, daysInMonth, monthStart, monthEnd, today } =
      getMonthBounds(month);

    const allUserMetrics = [...user.metrics]
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));
    const metricsUpToMonthEnd = allUserMetrics.filter(
      (m) => m.recordedDate <= monthEnd,
    );
    const earliestFallbackMetric = allUserMetrics[0] ?? null;

    const workoutsInMonth = user.workouts.filter(
      (w) =>
        w.userId === userId &&
        w.loggedDate >= monthStart &&
        w.loggedDate <= monthEnd,
    );
    const nutritionInMonth = user.nutrition.filter(
      (n) =>
        n.userId === userId &&
        n.loggedDate >= monthStart &&
        n.loggedDate <= monthEnd,
    );

    return buildMonthlyCalendarResponse({
      month: resolvedMonth,
      daysInMonth,
      today,
      profile: {
        ...user.profile,
        supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
      },
      goal: cloneGoalDTO(activeGoal),
      metricsUpToMonthEnd,
      earliestFallbackMetric,
      workoutsInMonth,
      nutritionInMonth,
    });
  }

  async getWeeklyCoachStatus(
    userId: string,
    weekStart?: string,
  ): Promise<WeeklyCoachStatusResponse> {
    const user = this.requireUser(userId);
    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    const { weekStartDate, weekEndDate } = getWeekBounds(weekStart);
    const goalDTO = cloneGoalDTO(activeGoal);
    const profileDTO: UserProfileDTO = {
      ...user.profile,
      supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
    };

    const metricsUpToWeekEnd = user.metrics.filter(
      (m) => m.userId === userId && m.recordedDate <= weekEndDate,
    );
    const workoutsForWeek = user.workouts.filter(
      (w) =>
        w.userId === userId &&
        w.loggedDate >= weekStartDate &&
        w.loggedDate <= weekEndDate,
    );
    const nutritionForWeek = user.nutrition.filter(
      (n) =>
        n.userId === userId &&
        n.loggedDate >= weekStartDate &&
        n.loggedDate <= weekEndDate,
    );

    const liveMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile: profileDTO,
      goal: goalDTO,
      metricsUpToWeekEnd,
      workoutsForWeek,
      nutritionForWeek,
    });
    const liveRecommendation = evaluateAdaptiveAdjustment(liveMetrics, goalDTO);

    const existing = user.coachReports.find((r) => r.weekStartDate === weekStartDate);
    return {
      report: existing ? cloneWeeklyCoachReport(existing) : null,
      liveMetrics,
      liveRecommendation,
    };
  }

  async generateWeeklyCoachReport(
    userId: string,
    options?: {
      weekStart?: string;
      force?: boolean;
      generateNarrative?: WeeklyCoachNarrativeFn;
    },
  ): Promise<WeeklyCoachReportDTO> {
    const user = this.requireUser(userId);
    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    const { weekStartDate, weekEndDate } = getWeekBounds(options?.weekStart);
    const existingIndex = user.coachReports.findIndex(
      (r) => r.weekStartDate === weekStartDate,
    );
    if (existingIndex !== -1 && !options?.force) {
      return cloneWeeklyCoachReport(user.coachReports[existingIndex]);
    }

    const goalDTO = cloneGoalDTO(activeGoal);
    const profileDTO: UserProfileDTO = {
      ...user.profile,
      supplementStack: user.profile.supplementStack.map((s) => ({ ...s })),
    };

    const metricsUpToWeekEnd = user.metrics.filter(
      (m) => m.userId === userId && m.recordedDate <= weekEndDate,
    );
    const workoutsForWeek = user.workouts.filter(
      (w) =>
        w.userId === userId &&
        w.loggedDate >= weekStartDate &&
        w.loggedDate <= weekEndDate,
    );
    const nutritionForWeek = user.nutrition.filter(
      (n) =>
        n.userId === userId &&
        n.loggedDate >= weekStartDate &&
        n.loggedDate <= weekEndDate,
    );

    const metrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile: profileDTO,
      goal: goalDTO,
      metricsUpToWeekEnd,
      workoutsForWeek,
      nutritionForWeek,
    });
    const recommendation = evaluateAdaptiveAdjustment(metrics, goalDTO);
    const narrativeFn = options?.generateNarrative ?? generateWeeklyCoachNarrative;
    const narrative = await narrativeFn(metrics, recommendation, goalDTO);

    const report: WeeklyCoachReportDTO = {
      id:
        existingIndex !== -1
          ? user.coachReports[existingIndex].id
          : `coach-${crypto.randomUUID()}`,
      userId,
      weekStartDate,
      weekEndDate,
      metrics,
      recommendation,
      narrative,
      appliedAt: null,
      generatedAt: new Date().toISOString(),
    };

    if (existingIndex !== -1) {
      user.coachReports[existingIndex] = report;
    } else {
      user.coachReports.push(report);
    }

    return cloneWeeklyCoachReport(report);
  }

  async applyWeeklyCoachRecommendation(
    userId: string,
    reportId: string,
    email?: string | null,
  ): Promise<ApplyWeeklyCoachResponse> {
    const user = this.requireUser(userId);
    const report = user.coachReports.find(
      (r) => r.id === reportId && r.userId === userId,
    );
    if (!report) {
      throw new HTTPException(404, {
        message: 'Weekly coach report not found.',
      });
    }

    const activeGoal = user.goals.find((g) => g.isActive);
    if (!activeGoal) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    if (!report.recommendation.canApply) {
      throw new HTTPException(400, {
        message: 'Recommendation does not propose an applicable calorie adjustment.',
      });
    }

    if (!report.appliedAt) {
      activeGoal.calorieAdjustment = report.recommendation.suggestedCalorieAdjustment;
      report.appliedAt = new Date().toISOString();
    }

    const me = await this.getMe(userId, email);
    return {
      report: cloneWeeklyCoachReport(report),
      me,
    };
  }
}

function toBodyMetricDTO(row: typeof bodyMetrics.$inferSelect): BodyMetricDTO {
  return {
    id: row.id,
    userId: row.userId,
    recordedDate: row.recordedDate,
    weightKg: row.weightKg,
    bodyFatPct: row.bodyFatPct,
    skeletalMuscleMassKg: row.skeletalMuscleMassKg,
    restingHr: row.restingHr ?? null,
    sleepHours: row.sleepHours ?? null,
    notes: row.notes,
  };
}

function toWorkoutLogDTO(row: typeof workoutLogs.$inferSelect): WorkoutLogDTO {
  return {
    id: row.id,
    userId: row.userId,
    loggedDate: row.loggedDate,
    activityName: row.activityName,
    category: row.category,
    durationMin: row.durationMin,
    activeCalories: row.activeCalories,
    intensity: row.intensity,
    activityType: row.activityType ?? 'MANUAL',
    loggedAt: row.loggedAt.toISOString(),
  };
}

function toNutritionLogDTO(row: typeof nutritionLogs.$inferSelect): NutritionLogDTO {
  return {
    id: row.id,
    userId: row.userId,
    loggedDate: row.loggedDate,
    mealType: row.mealType,
    itemName: row.itemName,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    supplementKey: row.supplementKey,
    source: (row.source ?? 'MANUAL') as NutritionLogSource,
    loggedAt: row.loggedAt.toISOString(),
  };
}

function toProfileDTO(row: typeof userProfiles.$inferSelect): UserProfileDTO {
  return {
    id: row.id,
    name: row.name,
    sex: row.sex,
    birthDate: row.birthDate,
    age: calculateAge(row.birthDate),
    heightCm: row.heightCm,
    baselineActivityMultiplier: row.baselineActivityMultiplier,
    supplementStack: row.supplementStack,
    webhookKeyPrefix: row.webhookKeyPrefix ?? null,
  };
}

function toGoalDTO(row: typeof userGoals.$inferSelect): UserGoalDTO {
  return {
    id: row.id,
    userId: row.userId,
    goalType: row.goalType,
    calorieAdjustment: row.calorieAdjustment,
    proteinPerKg: row.proteinPerKg,
    fatRatio: row.fatRatio,
    isActive: row.isActive,
    calorieCycling: cloneCalorieCycling(row.calorieCyclingConfig),
  };
}

function toWeeklyCoachReportDTO(
  row: typeof weeklyCoachReports.$inferSelect,
): WeeklyCoachReportDTO {
  return cloneWeeklyCoachReport({
    id: row.id,
    userId: row.userId,
    weekStartDate: row.weekStartDate,
    weekEndDate: row.weekEndDate,
    metrics: row.metrics,
    recommendation: row.recommendation,
    narrative: row.narrative,
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
    generatedAt: row.generatedAt.toISOString(),
  });
}

export class PostgresHealthRepository implements HealthRepository {
  private phase6SchemaPromise: Promise<void> | null = null;

  constructor(private readonly db: Database) {}

  getStorageMode(): 'postgres' | 'memory' {
    return 'postgres';
  }

  private ensurePhase6Schema(): Promise<void> {
    if (!this.phase6SchemaPromise) {
      this.phase6SchemaPromise = (async () => {
        await this.db.execute(sql`
          ALTER TABLE public.user_goals
            ADD COLUMN IF NOT EXISTS calorie_cycling_config jsonb
        `);
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS public.weekly_coach_reports (
            id text PRIMARY KEY,
            user_id text NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
            week_start_date text NOT NULL,
            week_end_date text NOT NULL,
            metrics jsonb NOT NULL,
            recommendation jsonb NOT NULL,
            narrative jsonb NOT NULL,
            applied_at timestamptz,
            generated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await this.db.execute(sql`
          CREATE UNIQUE INDEX IF NOT EXISTS weekly_coach_reports_user_week_uniq
            ON public.weekly_coach_reports (user_id, week_start_date)
        `);
        await this.db.execute(sql`
          ALTER TABLE public.weekly_coach_reports ENABLE ROW LEVEL SECURITY
        `);
        await this.db.execute(sql`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
              REVOKE ALL ON TABLE public.weekly_coach_reports FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
              REVOKE ALL ON TABLE public.weekly_coach_reports FROM authenticated;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'weekly_coach_reports'
                  AND policyname = 'service_role_full_access'
              ) THEN
                CREATE POLICY service_role_full_access
                  ON public.weekly_coach_reports
                  FOR ALL
                  TO service_role
                  USING (true)
                  WITH CHECK (true);
              END IF;
            END IF;
          END $$
        `);
      })().catch((err) => {
        this.phase6SchemaPromise = null;
        throw err;
      });
    }
    return this.phase6SchemaPromise;
  }

  private async findProfileRow(
    userId: string,
  ): Promise<typeof userProfiles.$inferSelect | null> {
    const [profileRow] = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.id, userId))
      .limit(1);
    return profileRow ?? null;
  }

  private async requireProfileRow(
    userId: string,
  ): Promise<typeof userProfiles.$inferSelect> {
    const profileRow = await this.findProfileRow(userId);
    if (!profileRow) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }
    return profileRow;
  }

  private async getProfileAndGoal(userId: string): Promise<{
    profile: UserProfileDTO;
    goal: UserGoalDTO;
  }> {
    await this.ensurePhase6Schema();
    const [profileRow, [goalRow]] = await Promise.all([
      this.findProfileRow(userId),
      this.db
        .select()
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
        .orderBy(desc(userGoals.createdAt))
        .limit(1),
    ]);

    if (!profileRow || !goalRow) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    return {
      profile: toProfileDTO(profileRow),
      goal: toGoalDTO(goalRow),
    };
  }

  async getMe(userId: string, email?: string | null): Promise<MeResponseDTO> {
    await this.ensurePhase6Schema();
    const [profileRow, [goalRow]] = await Promise.all([
      this.findProfileRow(userId),
      this.db
        .select()
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
        .orderBy(desc(userGoals.createdAt))
        .limit(1),
    ]);

    if (!profileRow) {
      return {
        userId,
        email: email ?? null,
        onboarded: false,
        profile: null,
        goal: null,
        webhookKey: {
          configured: false,
          masked_key: null,
          prefix: null,
        },
      };
    }

    const webhookKey = buildWebhookKeyStatus(
      profileRow.webhookKeyPrefix,
      profileRow.webhookKeyHash,
    );

    if (!goalRow) {
      return {
        userId,
        email: email ?? null,
        onboarded: false,
        profile: null,
        goal: null,
        webhookKey,
      };
    }

    return {
      userId,
      email: email ?? null,
      onboarded: true,
      profile: toProfileDTO(profileRow),
      goal: toGoalDTO(goalRow),
      webhookKey,
    };
  }

  async completeOnboarding(
    userId: string,
    input: OnboardingProfileInput,
    fallbackName?: string,
    email?: string | null,
  ): Promise<MeResponseDTO> {
    await this.ensurePhase6Schema();
    const recordedDate = getBangkokDateString();
    const resolvedName = input.name?.trim() || fallbackName?.trim() || 'Athlete';
    const supplementStack = DEFAULT_SUPPLEMENT_STACK.map((s) => ({ ...s }));

    await this.db.transaction(async (tx) => {
      await tx
        .insert(userProfiles)
        .values({
          id: userId,
          name: resolvedName,
          sex: input.gender,
          birthDate: input.birth_date,
          heightCm: input.height_cm,
          baselineActivityMultiplier: input.baseline_activity_multiplier,
          supplementStack,
        })
        .onConflictDoUpdate({
          target: userProfiles.id,
          set: {
            name: resolvedName,
            sex: input.gender,
            birthDate: input.birth_date,
            heightCm: input.height_cm,
            baselineActivityMultiplier: input.baseline_activity_multiplier,
            supplementStack,
          },
        });

      await tx
        .update(userGoals)
        .set({ isActive: false })
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)));

      await tx.insert(userGoals).values({
        id: `goal-${crypto.randomUUID()}`,
        userId,
        goalType: input.goal_type,
        calorieAdjustment: input.calorie_adjustment,
        proteinPerKg: input.protein_per_kg,
        fatRatio: input.fat_ratio,
        isActive: true,
        calorieCyclingConfig: null,
      });

      await tx
        .insert(bodyMetrics)
        .values({
          id: `metric-${crypto.randomUUID()}`,
          userId,
          recordedDate,
          weightKg: input.weight_kg,
          bodyFatPct: input.body_fat_pct ?? null,
          skeletalMuscleMassKg: input.skeletal_muscle_kg ?? null,
          notes: 'Initial onboarding baseline',
        })
        .onConflictDoUpdate({
          target: [bodyMetrics.userId, bodyMetrics.recordedDate],
          set: {
            weightKg: input.weight_kg,
            bodyFatPct: input.body_fat_pct ?? null,
            skeletalMuscleMassKg: input.skeletal_muscle_kg ?? null,
            notes: 'Initial onboarding baseline',
          },
        });
    });

    return this.getMe(userId, email);
  }

  async generateWebhookKey(userId: string): Promise<WebhookKeyResponse> {
    await this.requireProfileRow(userId);
    const apiKey = `hk_live_${crypto.randomBytes(24).toString('hex')}`;
    const hash = hashWebhookApiKey(apiKey);
    const prefix = apiKey.slice(0, 12);
    const maskedKey = `${prefix}••••••••`;

    await this.db
      .update(userProfiles)
      .set({
        webhookKeyHash: hash,
        webhookKeyPrefix: prefix,
      })
      .where(eq(userProfiles.id, userId));

    return {
      api_key: apiKey,
      masked_key: maskedKey,
      created_at: new Date().toISOString(),
    };
  }

  async findUserIdByWebhookKeyHash(keyHash: string): Promise<string | null> {
    if (!keyHash) {
      return null;
    }
    const [row] = await this.db
      .select({
        id: userProfiles.id,
        webhookKeyHash: userProfiles.webhookKeyHash,
      })
      .from(userProfiles)
      .where(eq(userProfiles.webhookKeyHash, keyHash))
      .limit(1);

    if (!row || !hashesMatchTimingSafe(row.webhookKeyHash, keyHash)) {
      return null;
    }
    return row.id;
  }

  async getTodayData(userId: string, date?: string): Promise<DashboardTodayResponse> {
    await this.ensurePhase6Schema();
    const targetDate = date ?? getLocalDateString();
    const { weekStartDate, weekEndDate } = getWeekBounds(targetDate);

    const [{ profile, goal }, metricRowsUpToWeekEnd, weekWorkoutRows, weekNutritionRows] =
      await Promise.all([
        this.getProfileAndGoal(userId),
        this.db
          .select()
          .from(bodyMetrics)
          .where(
            and(eq(bodyMetrics.userId, userId), lte(bodyMetrics.recordedDate, weekEndDate)),
          )
          .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt)),
        this.db
          .select()
          .from(workoutLogs)
          .where(
            and(
              eq(workoutLogs.userId, userId),
              gte(workoutLogs.loggedDate, weekStartDate),
              lte(workoutLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(workoutLogs.loggedAt)),
        this.db
          .select()
          .from(nutritionLogs)
          .where(
            and(
              eq(nutritionLogs.userId, userId),
              gte(nutritionLogs.loggedDate, weekStartDate),
              lte(nutritionLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(nutritionLogs.loggedAt)),
      ]);

    const metricsUpToWeekEnd = metricRowsUpToWeekEnd.map(toBodyMetricDTO);
    let earliestFallbackMetric: BodyMetricDTO | null = metricsUpToWeekEnd[0] ?? null;

    if (metricsUpToWeekEnd.length === 0) {
      const fallback = await this.db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.userId, userId))
        .orderBy(desc(bodyMetrics.recordedDate), desc(bodyMetrics.createdAt))
        .limit(1);
      if (fallback[0]) {
        earliestFallbackMetric = toBodyMetricDTO(fallback[0]);
      }
    }

    const metricPool =
      metricsUpToWeekEnd.length > 0
        ? metricsUpToWeekEnd
        : earliestFallbackMetric
          ? [earliestFallbackMetric]
          : [];
    const latestMetric = selectLatestMetric(metricPool, targetDate);

    const workoutsInWeek: WorkoutLogDTO[] = weekWorkoutRows.map(toWorkoutLogDTO);
    const nutritionInWeek: NutritionLogDTO[] = weekNutritionRows.map(toNutritionLogDTO);
    const workouts = workoutsInWeek.filter((w) => w.loggedDate === targetDate);
    const nutritionForDate = nutritionInWeek.filter((n) => n.loggedDate === targetDate);

    const weeklyBudget = buildWeeklyBudgetSummary({
      targetDate,
      profile,
      goal,
      metricsUpToWeekEnd,
      earliestFallbackMetric,
      workoutsInWeek,
      nutritionInWeek,
    });

    return buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'postgres',
      profile,
      goal,
      latestMetric,
      workouts,
      nutritionForDate,
      weeklyBudget,
    });
  }

  async getTrends(userId: string, days: number): Promise<MetricsTrendsResponse> {
    const rows = await this.db
      .select()
      .from(bodyMetrics)
      .where(eq(bodyMetrics.userId, userId))
      .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt));

    const metrics: BodyMetricDTO[] = rows.map(toBodyMetricDTO);

    return computeBodyTrends(metrics, days);
  }

  async createNutritionLog(
    userId: string,
    input: CreateNutritionLogInput,
  ): Promise<NutritionLogDTO> {
    await this.requireProfileRow(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();
    const id = `nutrition-${crypto.randomUUID()}`;

    const [inserted] = await this.db
      .insert(nutritionLogs)
      .values({
        id,
        userId,
        loggedDate,
        mealType: input.mealType,
        itemName: input.itemName,
        calories: input.calories,
        proteinG: input.proteinG,
        carbsG: input.carbsG,
        fatG: input.fatG,
        supplementKey: null,
        source: 'MANUAL',
      })
      .returning();

    return toNutritionLogDTO(inserted);
  }

  async createNutritionLogsBatch(
    userId: string,
    input: CreateBatchNutritionLogsInput,
  ): Promise<NutritionLogDTO[]> {
    if (input.items.length === 0) {
      return [];
    }

    await this.requireProfileRow(userId);
    const defaultDate = getLocalDateString();
    const baseTimeMs = Date.now();

    const rowsToInsert = input.items.map((item, idx) => ({
      id: `nutrition-${crypto.randomUUID()}`,
      userId,
      loggedDate: item.loggedDate ?? defaultDate,
      mealType: item.mealType,
      itemName: item.itemName,
      calories: item.calories,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
      supplementKey: null,
      source: input.source,
      loggedAt: new Date(baseTimeMs + idx),
    }));

    const inserted = await this.db.transaction(async (tx) =>
      tx.insert(nutritionLogs).values(rowsToInsert).returning(),
    );

    return inserted.map(toNutritionLogDTO);
  }

  async deleteNutritionLog(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(nutritionLogs)
      .where(and(eq(nutritionLogs.id, id), eq(nutritionLogs.userId, userId)))
      .returning({ id: nutritionLogs.id });
    return deleted.length > 0;
  }

  async createWorkoutLog(
    userId: string,
    input: CreateWorkoutLogInput,
  ): Promise<WorkoutLogDTO> {
    await this.requireProfileRow(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();
    const id = `workout-${crypto.randomUUID()}`;

    const [inserted] = await this.db
      .insert(workoutLogs)
      .values({
        id,
        userId,
        loggedDate,
        activityName: input.activityName,
        category: input.category,
        durationMin: input.durationMin,
        activeCalories: input.activeCalories,
        intensity: input.intensity,
        activityType: 'MANUAL',
      })
      .returning();

    return toWorkoutLogDTO(inserted);
  }

  async deleteWorkoutLog(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(workoutLogs)
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, userId)))
      .returning({ id: workoutLogs.id });
    return deleted.length > 0;
  }

  async toggleSupplement(
    userId: string,
    input: ToggleSupplementInput,
  ): Promise<ToggleSupplementResult> {
    const profileRow = await this.requireProfileRow(userId);
    const loggedDate = input.loggedDate ?? getLocalDateString();

    const existing = await this.db
      .select({ id: nutritionLogs.id })
      .from(nutritionLogs)
      .where(
        and(
          eq(nutritionLogs.userId, userId),
          eq(nutritionLogs.loggedDate, loggedDate),
          eq(nutritionLogs.mealType, 'supplement'),
          eq(nutritionLogs.supplementKey, input.supplementKey),
        ),
      );

    if (existing.length > 0) {
      await this.db
        .delete(nutritionLogs)
        .where(
          and(
            eq(nutritionLogs.userId, userId),
            eq(nutritionLogs.loggedDate, loggedDate),
            eq(nutritionLogs.mealType, 'supplement'),
            eq(nutritionLogs.supplementKey, input.supplementKey),
          ),
        );
      return { supplementKey: input.supplementKey, taken: false, loggedDate };
    }

    const suppConfig = profileRow.supplementStack.find(
      (s) => s.key === input.supplementKey,
    );

    await this.db.insert(nutritionLogs).values({
      id: `supp-${crypto.randomUUID()}`,
      userId,
      loggedDate,
      mealType: 'supplement',
      itemName: suppConfig?.name ?? input.supplementKey,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      supplementKey: input.supplementKey,
      source: 'MANUAL',
    });

    return { supplementKey: input.supplementKey, taken: true, loggedDate };
  }

  async createBodyMetric(
    userId: string,
    input: CreateBodyMetricInput,
  ): Promise<BodyMetricDTO> {
    await this.requireProfileRow(userId);
    const recordedDate = input.recordedDate ?? getLocalDateString();
    const id = `metric-${crypto.randomUUID()}`;

    const [upserted] = await this.db
      .insert(bodyMetrics)
      .values({
        id,
        userId,
        recordedDate,
        weightKg: input.weightKg,
        bodyFatPct: input.bodyFatPct ?? null,
        skeletalMuscleMassKg: input.skeletalMuscleMassKg ?? null,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [bodyMetrics.userId, bodyMetrics.recordedDate],
        set: {
          weightKg: input.weightKg,
          bodyFatPct:
            input.bodyFatPct !== undefined
              ? input.bodyFatPct
              : sql`${bodyMetrics.bodyFatPct}`,
          skeletalMuscleMassKg:
            input.skeletalMuscleMassKg !== undefined
              ? input.skeletalMuscleMassKg
              : sql`${bodyMetrics.skeletalMuscleMassKg}`,
          notes: input.notes !== undefined ? input.notes : sql`${bodyMetrics.notes}`,
        },
      })
      .returning();

    return toBodyMetricDTO(upserted);
  }

  async syncAppleHealth(
    userId: string,
    payload: AppleHealthWebhookPayload,
  ): Promise<AppleHealthWebhookResponse> {
    await this.requireProfileRow(userId);
    const recordedDate = payload.recorded_date ?? getBangkokDateString();
    const updatedFields = collectAppleHealthUpdatedFields(payload);
    const syncedAt = new Date();

    await this.db.transaction(async (tx) => {
      if (hasAppleHealthBodyMetricFields(payload)) {
        let insertWeightKg = payload.weight_kg;
        if (insertWeightKg === undefined) {
          const [priorMetric] = await tx
            .select({ weightKg: bodyMetrics.weightKg })
            .from(bodyMetrics)
            .where(
              and(
                eq(bodyMetrics.userId, userId),
                lte(bodyMetrics.recordedDate, recordedDate),
              ),
            )
            .orderBy(desc(bodyMetrics.recordedDate), desc(bodyMetrics.createdAt))
            .limit(1);

          if (priorMetric) {
            insertWeightKg = priorMetric.weightKg;
          } else {
            const [anyMetric] = await tx
              .select({ weightKg: bodyMetrics.weightKg })
              .from(bodyMetrics)
              .where(eq(bodyMetrics.userId, userId))
              .orderBy(desc(bodyMetrics.recordedDate), desc(bodyMetrics.createdAt))
              .limit(1);
            insertWeightKg = anyMetric?.weightKg ?? DEFAULT_FALLBACK_WEIGHT_KG;
          }
        }

        await tx
          .insert(bodyMetrics)
          .values({
            id: `metric-${crypto.randomUUID()}`,
            userId,
            recordedDate,
            weightKg: insertWeightKg,
            bodyFatPct: payload.body_fat_pct ?? null,
            skeletalMuscleMassKg: payload.skeletal_muscle_kg ?? null,
            restingHr: payload.resting_hr ?? null,
            sleepHours: payload.sleep_hours ?? null,
            notes: null,
          })
          .onConflictDoUpdate({
            target: [bodyMetrics.userId, bodyMetrics.recordedDate],
            set: {
              weightKg: sql`COALESCE(CAST(${payload.weight_kg ?? null} AS double precision), ${bodyMetrics.weightKg})`,
              bodyFatPct: sql`COALESCE(CAST(${payload.body_fat_pct ?? null} AS double precision), ${bodyMetrics.bodyFatPct})`,
              skeletalMuscleMassKg: sql`COALESCE(CAST(${payload.skeletal_muscle_kg ?? null} AS double precision), ${bodyMetrics.skeletalMuscleMassKg})`,
              restingHr: sql`COALESCE(CAST(${payload.resting_hr ?? null} AS double precision), ${bodyMetrics.restingHr})`,
              sleepHours: sql`COALESCE(CAST(${payload.sleep_hours ?? null} AS double precision), ${bodyMetrics.sleepHours})`,
            },
          });
      }

      if (payload.active_calories !== undefined) {
        const existingHealthWorkouts = await tx
          .select({ id: workoutLogs.id })
          .from(workoutLogs)
          .where(
            and(
              eq(workoutLogs.userId, userId),
              eq(workoutLogs.loggedDate, recordedDate),
              eq(workoutLogs.activityType, 'APPLE_HEALTH_SYNC'),
            ),
          )
          .limit(1);

        if (existingHealthWorkouts[0]) {
          await tx
            .update(workoutLogs)
            .set({
              activeCalories: payload.active_calories,
              loggedAt: syncedAt,
            })
            .where(
              and(
                eq(workoutLogs.id, existingHealthWorkouts[0].id),
                eq(workoutLogs.userId, userId),
              ),
            );
        } else {
          await tx.insert(workoutLogs).values({
            id: `workout-${crypto.randomUUID()}`,
            userId,
            loggedDate: recordedDate,
            activityName: 'Apple Health Active Energy',
            category: 'cardio',
            durationMin: 0,
            activeCalories: payload.active_calories,
            intensity: 'moderate',
            activityType: 'APPLE_HEALTH_SYNC',
            loggedAt: syncedAt,
          });
        }
      }

      await tx.insert(syncLogs).values({
        id: `sync-${crypto.randomUUID()}`,
        userId,
        source: 'APPLE_HEALTH',
        payloadSummary: {
          recorded_date: recordedDate,
          synced_fields: updatedFields,
        },
        syncedAt,
      });
    });

    const dashboard = await this.getTodayData(userId, recordedDate);
    return {
      ok: true,
      recorded_date: recordedDate,
      updated_fields: updatedFields,
      dynamic_tdee: dashboard.energy.dynamicTdee,
      target_calories: dashboard.energy.targetCalories,
      synced_at: syncedAt.toISOString(),
    };
  }

  async getAppleHealthSyncStatus(userId: string): Promise<SyncStatusDTO> {
    const [latest] = await this.db
      .select()
      .from(syncLogs)
      .where(and(eq(syncLogs.userId, userId), eq(syncLogs.source, 'APPLE_HEALTH')))
      .orderBy(desc(syncLogs.syncedAt))
      .limit(1);

    if (!latest) {
      return {
        status: 'NEVER',
        last_synced_at: null,
        synced_fields: [],
      };
    }

    return {
      status: 'SUCCESS',
      last_synced_at: latest.syncedAt.toISOString(),
      synced_fields: latest.payloadSummary.synced_fields ?? [],
    };
  }

  async updateSupplementStack(
    userId: string,
    supplements: SupplementConfig[],
  ): Promise<SupplementConfig[]> {
    const nextStack = supplements.map((s) => ({ ...s }));
    const [updated] = await this.db
      .update(userProfiles)
      .set({ supplementStack: nextStack })
      .where(eq(userProfiles.id, userId))
      .returning({ supplementStack: userProfiles.supplementStack });

    if (!updated) {
      throw new HTTPException(404, {
        message: 'User profile not found. Complete onboarding first.',
      });
    }

    return updated.supplementStack.map((s) => ({ ...s }));
  }

  async updateProfileSettings(
    userId: string,
    input: UpdateProfileSettingsRepoInput,
    email?: string | null,
  ): Promise<MeResponseDTO> {
    await this.ensurePhase6Schema();
    await this.db.transaction(async (tx) => {
      const [updatedProfile] = await tx
        .update(userProfiles)
        .set({
          name: input.name.trim(),
          sex: input.gender,
          birthDate: input.birth_date,
          heightCm: input.height_cm,
          baselineActivityMultiplier: input.baseline_activity_multiplier,
        })
        .where(eq(userProfiles.id, userId))
        .returning({ id: userProfiles.id });

      if (!updatedProfile) {
        throw new HTTPException(404, {
          message: 'User profile not found. Complete onboarding first.',
        });
      }

      const [activeGoalRow] = await tx
        .select({ id: userGoals.id })
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
        .orderBy(desc(userGoals.createdAt))
        .limit(1);

      if (!activeGoalRow) {
        throw new HTTPException(404, {
          message: 'User profile not found. Complete onboarding first.',
        });
      }

      await tx
        .update(userGoals)
        .set({
          goalType: input.goal_type,
          calorieAdjustment: input.calorie_adjustment,
          proteinPerKg: input.protein_per_kg,
          fatRatio: input.fat_ratio,
          ...(input.calorie_cycling !== undefined
            ? { calorieCyclingConfig: cloneCalorieCycling(input.calorie_cycling) }
            : {}),
        })
        .where(eq(userGoals.id, activeGoalRow.id));
    });

    return this.getMe(userId, email);
  }

  async getBootstrapData(
    userId: string,
    days: number,
    email?: string | null,
    date?: string,
  ): Promise<DashboardBootstrapResponse> {
    await this.ensurePhase6Schema();
    const targetDate = date ?? getLocalDateString();
    const { weekStartDate, weekEndDate } = getWeekBounds(targetDate);

    const [
      profileRow,
      [goalRow],
      metricRows,
      workoutRows,
      nutritionRows,
      [latestSyncRow],
    ] = await Promise.all([
      this.findProfileRow(userId),
      this.db
        .select()
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
        .orderBy(desc(userGoals.createdAt))
        .limit(1),
      this.db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.userId, userId))
        .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt)),
      this.db
        .select()
        .from(workoutLogs)
        .where(
          and(
            eq(workoutLogs.userId, userId),
            gte(workoutLogs.loggedDate, weekStartDate),
            lte(workoutLogs.loggedDate, weekEndDate),
          ),
        )
        .orderBy(asc(workoutLogs.loggedAt)),
      this.db
        .select()
        .from(nutritionLogs)
        .where(
          and(
            eq(nutritionLogs.userId, userId),
            gte(nutritionLogs.loggedDate, weekStartDate),
            lte(nutritionLogs.loggedDate, weekEndDate),
          ),
        )
        .orderBy(asc(nutritionLogs.loggedAt)),
      this.db
        .select()
        .from(syncLogs)
        .where(and(eq(syncLogs.userId, userId), eq(syncLogs.source, 'APPLE_HEALTH')))
        .orderBy(desc(syncLogs.syncedAt))
        .limit(1),
    ]);

    const syncStatus = buildSyncStatus(latestSyncRow);
    const webhookKey = profileRow
      ? buildWebhookKeyStatus(profileRow.webhookKeyPrefix, profileRow.webhookKeyHash)
      : { configured: false, masked_key: null, prefix: null };

    if (!profileRow || !goalRow) {
      return {
        me: {
          userId,
          email: email ?? null,
          onboarded: false,
          profile: null,
          goal: null,
          webhookKey,
        },
        dashboard: null,
        trends: null,
        syncStatus,
      };
    }

    const allMetrics = metricRows.map(toBodyMetricDTO);
    const latestMetric = selectLatestMetric(allMetrics, targetDate);
    const metricsUpToWeekEnd = allMetrics.filter((m) => m.recordedDate <= weekEndDate);
    const earliestFallbackMetric = allMetrics[0] ?? null;

    const profileDTO = toProfileDTO(profileRow);
    const goalDTO = toGoalDTO(goalRow);

    const me: MeResponseDTO = {
      userId,
      email: email ?? null,
      onboarded: true,
      profile: profileDTO,
      goal: goalDTO,
      webhookKey,
    };

    const workoutsInWeek = workoutRows.map(toWorkoutLogDTO);
    const nutritionInWeek = nutritionRows.map(toNutritionLogDTO);
    const workouts = workoutsInWeek.filter((w) => w.loggedDate === targetDate);
    const nutritionForDate = nutritionInWeek.filter((n) => n.loggedDate === targetDate);

    const weeklyBudget = buildWeeklyBudgetSummary({
      targetDate,
      profile: profileDTO,
      goal: goalDTO,
      metricsUpToWeekEnd,
      earliestFallbackMetric,
      workoutsInWeek,
      nutritionInWeek,
    });

    const dashboard = buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'postgres',
      profile: profileDTO,
      goal: goalDTO,
      latestMetric,
      workouts,
      nutritionForDate,
      weeklyBudget,
    });

    const trends = computeBodyTrends(allMetrics, days);

    return { me, dashboard, trends, syncStatus };
  }

  async getMonthlyCalendar(
    userId: string,
    month?: string,
  ): Promise<MonthlyCalendarResponse> {
    await this.ensurePhase6Schema();
    const { resolvedMonth, daysInMonth, monthStart, monthEnd, today } =
      getMonthBounds(month);

    const [{ profile, goal }, metricRows, workoutRows, nutritionRows] =
      await Promise.all([
        this.getProfileAndGoal(userId),
        this.db
          .select()
          .from(bodyMetrics)
          .where(
            and(eq(bodyMetrics.userId, userId), lte(bodyMetrics.recordedDate, monthEnd)),
          )
          .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt)),
        this.db
          .select()
          .from(workoutLogs)
          .where(
            and(
              eq(workoutLogs.userId, userId),
              gte(workoutLogs.loggedDate, monthStart),
              lte(workoutLogs.loggedDate, monthEnd),
            ),
          ),
        this.db
          .select()
          .from(nutritionLogs)
          .where(
            and(
              eq(nutritionLogs.userId, userId),
              gte(nutritionLogs.loggedDate, monthStart),
              lte(nutritionLogs.loggedDate, monthEnd),
            ),
          ),
      ]);

    const metricsUpToMonthEnd = metricRows.map(toBodyMetricDTO);
    let earliestFallbackMetric: BodyMetricDTO | null = metricsUpToMonthEnd[0] ?? null;

    if (!earliestFallbackMetric) {
      const [earliestRow] = await this.db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.userId, userId))
        .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt))
        .limit(1);
      earliestFallbackMetric = earliestRow ? toBodyMetricDTO(earliestRow) : null;
    }

    return buildMonthlyCalendarResponse({
      month: resolvedMonth,
      daysInMonth,
      today,
      profile,
      goal,
      metricsUpToMonthEnd,
      earliestFallbackMetric,
      workoutsInMonth: workoutRows.map(toWorkoutLogDTO),
      nutritionInMonth: nutritionRows.map(toNutritionLogDTO),
    });
  }

  async getWeeklyCoachStatus(
    userId: string,
    weekStart?: string,
  ): Promise<WeeklyCoachStatusResponse> {
    await this.ensurePhase6Schema();
    const { weekStartDate, weekEndDate } = getWeekBounds(weekStart);

    const [{ profile, goal }, metricRows, workoutRows, nutritionRows, [reportRow]] =
      await Promise.all([
        this.getProfileAndGoal(userId),
        this.db
          .select()
          .from(bodyMetrics)
          .where(
            and(eq(bodyMetrics.userId, userId), lte(bodyMetrics.recordedDate, weekEndDate)),
          )
          .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt)),
        this.db
          .select()
          .from(workoutLogs)
          .where(
            and(
              eq(workoutLogs.userId, userId),
              gte(workoutLogs.loggedDate, weekStartDate),
              lte(workoutLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(workoutLogs.loggedAt)),
        this.db
          .select()
          .from(nutritionLogs)
          .where(
            and(
              eq(nutritionLogs.userId, userId),
              gte(nutritionLogs.loggedDate, weekStartDate),
              lte(nutritionLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(nutritionLogs.loggedAt)),
        this.db
          .select()
          .from(weeklyCoachReports)
          .where(
            and(
              eq(weeklyCoachReports.userId, userId),
              eq(weeklyCoachReports.weekStartDate, weekStartDate),
            ),
          )
          .limit(1),
      ]);

    const liveMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal,
      metricsUpToWeekEnd: metricRows.map(toBodyMetricDTO),
      workoutsForWeek: workoutRows.map(toWorkoutLogDTO),
      nutritionForWeek: nutritionRows.map(toNutritionLogDTO),
    });
    const liveRecommendation = evaluateAdaptiveAdjustment(liveMetrics, goal);

    return {
      report: reportRow ? toWeeklyCoachReportDTO(reportRow) : null,
      liveMetrics,
      liveRecommendation,
    };
  }

  async generateWeeklyCoachReport(
    userId: string,
    options?: {
      weekStart?: string;
      force?: boolean;
      generateNarrative?: WeeklyCoachNarrativeFn;
    },
  ): Promise<WeeklyCoachReportDTO> {
    await this.ensurePhase6Schema();
    const { weekStartDate, weekEndDate } = getWeekBounds(options?.weekStart);

    const [{ profile, goal }, metricRows, workoutRows, nutritionRows, [existingRow]] =
      await Promise.all([
        this.getProfileAndGoal(userId),
        this.db
          .select()
          .from(bodyMetrics)
          .where(
            and(eq(bodyMetrics.userId, userId), lte(bodyMetrics.recordedDate, weekEndDate)),
          )
          .orderBy(asc(bodyMetrics.recordedDate), asc(bodyMetrics.createdAt)),
        this.db
          .select()
          .from(workoutLogs)
          .where(
            and(
              eq(workoutLogs.userId, userId),
              gte(workoutLogs.loggedDate, weekStartDate),
              lte(workoutLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(workoutLogs.loggedAt)),
        this.db
          .select()
          .from(nutritionLogs)
          .where(
            and(
              eq(nutritionLogs.userId, userId),
              gte(nutritionLogs.loggedDate, weekStartDate),
              lte(nutritionLogs.loggedDate, weekEndDate),
            ),
          )
          .orderBy(asc(nutritionLogs.loggedAt)),
        this.db
          .select()
          .from(weeklyCoachReports)
          .where(
            and(
              eq(weeklyCoachReports.userId, userId),
              eq(weeklyCoachReports.weekStartDate, weekStartDate),
            ),
          )
          .limit(1),
      ]);

    if (existingRow && !options?.force) {
      return toWeeklyCoachReportDTO(existingRow);
    }

    const metrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal,
      metricsUpToWeekEnd: metricRows.map(toBodyMetricDTO),
      workoutsForWeek: workoutRows.map(toWorkoutLogDTO),
      nutritionForWeek: nutritionRows.map(toNutritionLogDTO),
    });
    const recommendation = evaluateAdaptiveAdjustment(metrics, goal);
    const narrativeFn = options?.generateNarrative ?? generateWeeklyCoachNarrative;
    const narrative = await narrativeFn(metrics, recommendation, goal);

    const now = new Date();
    const [saved] = await this.db
      .insert(weeklyCoachReports)
      .values({
        id: `coach-${crypto.randomUUID()}`,
        userId,
        weekStartDate,
        weekEndDate,
        metrics,
        recommendation,
        narrative,
        appliedAt: null,
        generatedAt: now,
      })
      .onConflictDoUpdate({
        target: [weeklyCoachReports.userId, weeklyCoachReports.weekStartDate],
        set: {
          weekEndDate,
          metrics,
          recommendation,
          narrative,
          appliedAt: null,
          generatedAt: now,
        },
      })
      .returning();

    return toWeeklyCoachReportDTO(saved);
  }

  async applyWeeklyCoachRecommendation(
    userId: string,
    reportId: string,
    email?: string | null,
  ): Promise<ApplyWeeklyCoachResponse> {
    await this.ensurePhase6Schema();

    const report = await this.db.transaction(async (tx) => {
      const [reportRow] = await tx
        .select()
        .from(weeklyCoachReports)
        .where(
          and(eq(weeklyCoachReports.id, reportId), eq(weeklyCoachReports.userId, userId)),
        )
        .limit(1);

      if (!reportRow) {
        throw new HTTPException(404, {
          message: 'Weekly coach report not found.',
        });
      }

      const [activeGoalRow] = await tx
        .select({ id: userGoals.id })
        .from(userGoals)
        .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
        .orderBy(desc(userGoals.createdAt))
        .limit(1);

      if (!activeGoalRow) {
        throw new HTTPException(404, {
          message: 'User profile not found. Complete onboarding first.',
        });
      }

      if (!reportRow.recommendation.canApply) {
        throw new HTTPException(400, {
          message: 'Recommendation does not propose an applicable calorie adjustment.',
        });
      }

      if (reportRow.appliedAt) {
        return toWeeklyCoachReportDTO(reportRow);
      }

      await tx
        .update(userGoals)
        .set({
          calorieAdjustment: reportRow.recommendation.suggestedCalorieAdjustment,
        })
        .where(eq(userGoals.id, activeGoalRow.id));

      const [updatedReport] = await tx
        .update(weeklyCoachReports)
        .set({ appliedAt: new Date() })
        .where(
          and(eq(weeklyCoachReports.id, reportId), eq(weeklyCoachReports.userId, userId)),
        )
        .returning();

      return toWeeklyCoachReportDTO(updatedReport);
    });

    const me = await this.getMe(userId, email);
    return { report, me };
  }
}

let inMemorySingleton: InMemoryHealthRepository | null = null;
let postgresSingleton: PostgresHealthRepository | null = null;

/**
 * Returns the active HealthRepository: PostgreSQL when DATABASE_URL is configured,
 * otherwise a deterministic in-memory repository initialized from seed data.
 */
export function getRepository(): HealthRepository {
  const db = getDb();
  if (db) {
    if (!postgresSingleton) {
      postgresSingleton = new PostgresHealthRepository(db);
    }
    return postgresSingleton;
  }

  if (!inMemorySingleton) {
    inMemorySingleton = new InMemoryHealthRepository();
  }
  return inMemorySingleton;
}

export { SEED_USER_ID };
