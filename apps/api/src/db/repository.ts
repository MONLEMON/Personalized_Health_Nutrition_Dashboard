import crypto from 'node:crypto';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  AppleHealthWebhookPayload,
  AppleHealthWebhookResponse,
  BodyMetricDTO,
  DashboardTodayResponse,
  MacroProgress,
  MeResponseDTO,
  MetricsTrendsResponse,
  NutritionLogDTO,
  NutritionLogSource,
  SupplementStatusDTO,
  SyncStatusDTO,
  UserGoalDTO,
  UserProfileDTO,
  WebhookKeyResponse,
  WebhookKeyStatusDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import type {
  CreateBatchNutritionLogsInput,
  CreateBodyMetricInput,
  CreateNutritionLogInput,
  CreateWorkoutLogInput,
  OnboardingProfileInput,
  ToggleSupplementInput,
} from '@health-dash/shared';
import { getDb, type Database } from './index';
import {
  bodyMetrics,
  nutritionLogs,
  syncLogs,
  userGoals,
  userProfiles,
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
} from '../services/tdee.service';
import { computeBodyTrends } from '../services/trends.service';

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

function buildDashboardTodayResponse(params: {
  date: string;
  storageMode: 'postgres' | 'memory';
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  latestMetric: BodyMetricDTO;
  workouts: WorkoutLogDTO[];
  nutritionForDate: NutritionLogDTO[];
}): DashboardTodayResponse {
  const { date, storageMode, profile, goal, latestMetric, workouts, nutritionForDate } =
    params;

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

  const targetCalories = calculateTargetCalories({
    dynamicTdee,
    calorieAdjustment: goal.calorieAdjustment,
  });

  const macroTargets = calculateMacroTargets({
    targetCalories,
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
      goals: [{ ...seed.goal }],
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
      goal: { ...activeGoal },
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
    const eligibleMetrics = user.metrics.filter((m) => m.recordedDate <= targetDate);
    const pool = eligibleMetrics.length > 0 ? eligibleMetrics : user.metrics;
    if (pool.length === 0) {
      throw new HTTPException(404, {
        message: 'No body metrics found for user. Complete onboarding first.',
      });
    }

    // Latest by recordedDate; array order preserves insertion order for same-day entries
    let latestMetric = pool[pool.length - 1];
    for (const metric of pool) {
      if (metric.recordedDate >= latestMetric.recordedDate) {
        latestMetric = metric;
      }
    }

    const workouts = user.workouts
      .filter((w) => w.userId === userId && w.loggedDate === targetDate)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
      .map((w) => ({ ...w, activityType: w.activityType ?? 'MANUAL' }));

    const nutritionForDate = user.nutrition
      .filter((n) => n.userId === userId && n.loggedDate === targetDate)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

    return buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'memory',
      profile: {
        ...user.profile,
        webhookKeyPrefix: user.webhookKeyPrefix,
      },
      goal: { ...activeGoal },
      latestMetric: {
        ...latestMetric,
        restingHr: latestMetric.restingHr ?? null,
        sleepHours: latestMetric.sleepHours ?? null,
      },
      workouts,
      nutritionForDate,
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
  };
}

export class PostgresHealthRepository implements HealthRepository {
  constructor(private readonly db: Database) {}

  getStorageMode(): 'postgres' | 'memory' {
    return 'postgres';
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
    const profileRow = await this.requireProfileRow(userId);

    const [goalRow] = await this.db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
      .orderBy(desc(userGoals.createdAt))
      .limit(1);

    if (!goalRow) {
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
    const profileRow = await this.findProfileRow(userId);
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

    const [goalRow] = await this.db
      .select()
      .from(userGoals)
      .where(and(eq(userGoals.userId, userId), eq(userGoals.isActive, true)))
      .orderBy(desc(userGoals.createdAt))
      .limit(1);

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
    const targetDate = date ?? getLocalDateString();
    const { profile, goal } = await this.getProfileAndGoal(userId);

    const eligibleMetrics = await this.db
      .select()
      .from(bodyMetrics)
      .where(and(eq(bodyMetrics.userId, userId), lte(bodyMetrics.recordedDate, targetDate)))
      .orderBy(desc(bodyMetrics.recordedDate), desc(bodyMetrics.createdAt))
      .limit(1);

    let metricRow = eligibleMetrics[0];
    if (!metricRow) {
      const fallback = await this.db
        .select()
        .from(bodyMetrics)
        .where(eq(bodyMetrics.userId, userId))
        .orderBy(desc(bodyMetrics.recordedDate), desc(bodyMetrics.createdAt))
        .limit(1);
      metricRow = fallback[0];
    }

    if (!metricRow) {
      throw new HTTPException(404, {
        message: 'No body metrics found for user. Complete onboarding first.',
      });
    }

    const latestMetric = toBodyMetricDTO(metricRow);

    const workoutRows = await this.db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), eq(workoutLogs.loggedDate, targetDate)))
      .orderBy(asc(workoutLogs.loggedAt));

    const workouts: WorkoutLogDTO[] = workoutRows.map(toWorkoutLogDTO);

    const nutritionRows = await this.db
      .select()
      .from(nutritionLogs)
      .where(
        and(eq(nutritionLogs.userId, userId), eq(nutritionLogs.loggedDate, targetDate)),
      )
      .orderBy(asc(nutritionLogs.loggedAt));

    const nutritionForDate: NutritionLogDTO[] = nutritionRows.map(toNutritionLogDTO);

    return buildDashboardTodayResponse({
      date: targetDate,
      storageMode: 'postgres',
      profile,
      goal,
      latestMetric,
      workouts,
      nutritionForDate,
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
