import { describe, expect, it } from 'bun:test';
import {
  WeeklyCoachAiNarrativeSchema,
  type ApplyWeeklyCoachResponse,
  type BodyMetricDTO,
  type CalorieCyclingConfig,
  type DashboardBootstrapResponse,
  type DashboardTodayResponse,
  type MeResponseDTO,
  type MonthlyCalendarResponse,
  type NutritionLogDTO,
  type UserGoalDTO,
  type UserProfileDTO,
  type WebhookKeyResponse,
  type WeeklyCoachAiNarrativeDTO,
  type WeeklyCoachMetricsDTO,
  type WeeklyCoachReportDTO,
  type WeeklyCoachStatusResponse,
  type WorkoutLogDTO,
} from '@health-dash/shared';
import type { Hono } from 'hono';
import { createApp } from '../../app';
import {
  getBangkokDateString,
  InMemoryHealthRepository,
  SEED_USER_ID,
} from '../../db/repository';
import { signHs256Jwt } from '../../middleware/auth';
import type { GeminiGenerateContentFn } from '../aiNutrition';
import {
  calculateMacroTargets,
  calculateTargetCalories,
  getWeekdayKey,
  resolveCalorieCyclingForDate,
} from '../tdee.service';
import {
  computeWeeklyCoachMetrics,
  evaluateAdaptiveAdjustment,
  generateWeeklyCoachNarrative,
  getWeekBounds,
  shiftIsoDate,
  type WeeklyCoachNarrativeFn,
} from '../weeklyCoach.service';

const TEST_JWT_SECRET = 'test-phase6-coach-cycling-jwt-secret-0123456789abcdef';
const USER_A_ID = 'aaaaaaaa-6666-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-6666-4bbb-8bbb-bbbbbbbbbbbb';
const USER_UNONBOARDED_ID = 'cccccccc-6666-4ccc-8ccc-cccccccccccc';

function createTestContext(options?: {
  generateWeeklyCoachNarrative?: WeeklyCoachNarrativeFn;
}) {
  const today = getBangkokDateString();
  const repo = new InMemoryHealthRepository(today);
  const app = createApp(repo, {
    jwtSecret: TEST_JWT_SECRET,
    generateWeeklyCoachNarrative: options?.generateWeeklyCoachNarrative,
  });
  return { app, repo, today };
}

function makeAuthHeaders(userId: string = SEED_USER_ID): Record<string, string> {
  const token = signHs256Jwt(
    { sub: userId, email: `${userId.slice(0, 8)}@example.com` },
    TEST_JWT_SECRET,
  );
  return { Authorization: `Bearer ${token}` };
}

async function onboardUser(
  app: Hono,
  headers: Record<string, string>,
  overrides: Partial<{
    name: string;
    gender: 'male' | 'female' | 'other';
    birth_date: string;
    height_cm: number;
    weight_kg: number;
    body_fat_pct: number | null;
    baseline_activity_multiplier: number;
    goal_type: 'CUT' | 'MAINTAIN' | 'BULK';
    calorie_adjustment: number;
    protein_per_kg: number;
    fat_ratio: number;
  }> = {},
): Promise<MeResponseDTO> {
  const payload = {
    name: 'Phase 6 Athlete',
    gender: 'male' as const,
    birth_date: '1995-04-12',
    height_cm: 176,
    weight_kg: 80,
    baseline_activity_multiplier: 1.35,
    goal_type: 'CUT' as const,
    calorie_adjustment: -350,
    protein_per_kg: 2.0,
    fat_ratio: 0.25,
    ...overrides,
  };

  const res = await app.request('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as MeResponseDTO;
}

function makeProfile(overrides: Partial<UserProfileDTO> = {}): UserProfileDTO {
  return {
    id: USER_A_ID,
    name: 'Coach Unit User',
    sex: 'male',
    birthDate: '1995-04-12',
    age: 31,
    heightCm: 176,
    baselineActivityMultiplier: 1.35,
    supplementStack: [
      { key: 'creatine', name: 'Creatine', dosage: '5g', timing: 'Daily' },
      { key: 'omega3', name: 'Omega-3', dosage: '2g', timing: 'With meal' },
    ],
    ...overrides,
  };
}

function makeGoal(overrides: Partial<UserGoalDTO> = {}): UserGoalDTO {
  return {
    id: 'goal-1',
    userId: USER_A_ID,
    goalType: 'CUT',
    calorieAdjustment: -350,
    proteinPerKg: 2.0,
    fatRatio: 0.25,
    isActive: true,
    calorieCycling: null,
    ...overrides,
  };
}

function makeMetric(
  recordedDate: string,
  weightKg: number,
  extra: Partial<BodyMetricDTO> = {},
): BodyMetricDTO {
  return {
    id: `bm-${recordedDate}`,
    userId: USER_A_ID,
    recordedDate,
    weightKg,
    bodyFatPct: null,
    skeletalMuscleMassKg: null,
    restingHr: null,
    sleepHours: null,
    notes: null,
    ...extra,
  };
}

function makeMeal(
  loggedDate: string,
  calories: number,
  proteinG: number,
  extra: Partial<NutritionLogDTO> = {},
): NutritionLogDTO {
  return {
    id: `nut-${loggedDate}-${Math.random().toString(36).slice(2, 7)}`,
    userId: USER_A_ID,
    loggedDate,
    mealType: 'lunch',
    itemName: 'Meal Bowl',
    calories,
    proteinG,
    carbsG: 150,
    fatG: 40,
    supplementKey: null,
    loggedAt: `${loggedDate}T12:00:00.000Z`,
    ...extra,
  };
}

function makeWorkout(
  loggedDate: string,
  activeCalories: number,
  extra: Partial<WorkoutLogDTO> = {},
): WorkoutLogDTO {
  return {
    id: `wo-${loggedDate}-${Math.random().toString(36).slice(2, 7)}`,
    userId: USER_A_ID,
    loggedDate,
    activityName: 'Upper Strength',
    category: 'strength',
    durationMin: 60,
    activeCalories,
    intensity: 'high',
    loggedAt: `${loggedDate}T18:00:00.000Z`,
    ...extra,
  };
}

const ZERO_OFFSETS: CalorieCyclingConfig['dayOffsets'] = {
  mon: 0,
  tue: 0,
  wed: 0,
  thu: 0,
  fri: 0,
  sat: 0,
  sun: 0,
};

describe('Phase 6: Calorie & Carb Cycling (Pure Logic + Settings/Dashboard/Calendar)', () => {
  it('resolveCalorieCyclingForDate resolves disabled, TRAINING_REST (scheduled & workout override), WEEKEND_BUFFER, and CUSTOM', () => {
    // 2026-10-12 = Mon, 2026-10-13 = Tue, 2026-10-17 = Sat, 2026-10-18 = Sun
    expect(getWeekdayKey('2026-10-12')).toBe('mon');
    expect(getWeekdayKey('2026-10-13')).toBe('tue');
    expect(getWeekdayKey('2026-10-17')).toBe('sat');
    expect(getWeekdayKey('2026-10-18')).toBe('sun');

    // Disabled variants
    expect(resolveCalorieCyclingForDate(null, '2026-10-12')).toEqual({
      offset: 0,
      dayType: 'base',
      label: null,
    });
    expect(resolveCalorieCyclingForDate(undefined, '2026-10-12')).toEqual({
      offset: 0,
      dayType: 'base',
      label: null,
    });
    expect(
      resolveCalorieCyclingForDate(
        {
          enabled: false,
          mode: 'TRAINING_REST',
          dayOffsets: ZERO_OFFSETS,
          trainingDayOffset: 200,
          restDayOffset: -150,
          trainingDays: ['mon', 'wed', 'fri', 'sat'],
        },
        '2026-10-12',
        true,
      ),
    ).toEqual({ offset: 0, dayType: 'base', label: null });
    expect(
      resolveCalorieCyclingForDate(
        {
          enabled: true,
          mode: 'NONE',
          dayOffsets: { ...ZERO_OFFSETS, mon: 300 },
          trainingDayOffset: 200,
          restDayOffset: -150,
          trainingDays: ['mon'],
        },
        '2026-10-12',
      ),
    ).toEqual({ offset: 0, dayType: 'base', label: null });

    // TRAINING_REST: scheduled training day, scheduled rest day, and logged workout override on rest day
    const trainingRestConfig: CalorieCyclingConfig = {
      enabled: true,
      mode: 'TRAINING_REST',
      dayOffsets: ZERO_OFFSETS,
      trainingDayOffset: 200,
      restDayOffset: -150,
      trainingDays: ['mon', 'wed', 'fri', 'sat'],
    };
    expect(resolveCalorieCyclingForDate(trainingRestConfig, '2026-10-12', false)).toEqual({
      offset: 200,
      dayType: 'high',
      label: 'Training High (+200 kcal)',
    });
    expect(resolveCalorieCyclingForDate(trainingRestConfig, '2026-10-13', false)).toEqual({
      offset: -150,
      dayType: 'low',
      label: 'Rest Low (-150 kcal)',
    });
    expect(resolveCalorieCyclingForDate(trainingRestConfig, '2026-10-13', true)).toEqual({
      offset: 200,
      dayType: 'high',
      label: 'Training High (+200 kcal)',
    });

    // WEEKEND_BUFFER: -100 Mon-Fri, +250 Sat-Sun
    const weekendBufferConfig: CalorieCyclingConfig = {
      enabled: true,
      mode: 'WEEKEND_BUFFER',
      dayOffsets: {
        mon: -100,
        tue: -100,
        wed: -100,
        thu: -100,
        fri: -100,
        sat: 250,
        sun: 250,
      },
      trainingDayOffset: 200,
      restDayOffset: -150,
      trainingDays: ['mon', 'wed', 'fri', 'sat'],
    };
    expect(resolveCalorieCyclingForDate(weekendBufferConfig, '2026-10-12')).toEqual({
      offset: -100,
      dayType: 'low',
      label: 'Weekday Save (-100 kcal)',
    });
    expect(resolveCalorieCyclingForDate(weekendBufferConfig, '2026-10-17')).toEqual({
      offset: 250,
      dayType: 'high',
      label: 'Weekend Buffer (+250 kcal)',
    });

    // CUSTOM: high, low, and zero base day
    const customConfig: CalorieCyclingConfig = {
      enabled: true,
      mode: 'CUSTOM',
      dayOffsets: {
        mon: 150,
        tue: -120,
        wed: 0,
        thu: -120,
        fri: 150,
        sat: 100,
        sun: -160,
      },
      trainingDayOffset: 200,
      restDayOffset: -150,
      trainingDays: [],
    };
    expect(resolveCalorieCyclingForDate(customConfig, '2026-10-12')).toEqual({
      offset: 150,
      dayType: 'high',
      label: 'Custom High (+150 kcal)',
    });
    expect(resolveCalorieCyclingForDate(customConfig, '2026-10-13')).toEqual({
      offset: -120,
      dayType: 'low',
      label: 'Custom Low (-120 kcal)',
    });
    expect(resolveCalorieCyclingForDate(customConfig, '2026-10-14')).toEqual({
      offset: 0,
      dayType: 'base',
      label: 'Base Day',
    });
  });

  it('implements True Carb Cycling math: protein & fat stay fixed from baseTargetCaloriesForFat while carbs scale with cyclingOffset', () => {
    const baseTarget = calculateTargetCalories({
      dynamicTdee: 2750,
      calorieAdjustment: -350,
    });
    expect(baseTarget).toBe(2400);

    const highDayTarget = calculateTargetCalories({
      dynamicTdee: 2750,
      calorieAdjustment: -350,
      cyclingOffset: 200,
    });
    const lowDayTarget = calculateTargetCalories({
      dynamicTdee: 2750,
      calorieAdjustment: -350,
      cyclingOffset: -200,
    });
    expect(highDayTarget).toBe(2600);
    expect(lowDayTarget).toBe(2200);

    // 1200 kcal floor still holds with negative cycling offset
    expect(
      calculateTargetCalories({
        dynamicTdee: 1500,
        calorieAdjustment: -250,
        cyclingOffset: -300,
      }),
    ).toBe(1200);

    const baseMacros = calculateMacroTargets({
      targetCalories: baseTarget,
      baseTargetCaloriesForFat: baseTarget,
      weightKg: 75,
      proteinPerKg: 2.0,
      fatRatio: 0.25,
    });
    const highMacros = calculateMacroTargets({
      targetCalories: highDayTarget,
      baseTargetCaloriesForFat: baseTarget,
      weightKg: 75,
      proteinPerKg: 2.0,
      fatRatio: 0.25,
    });
    const lowMacros = calculateMacroTargets({
      targetCalories: lowDayTarget,
      baseTargetCaloriesForFat: baseTarget,
      weightKg: 75,
      proteinPerKg: 2.0,
      fatRatio: 0.25,
    });

    // Protein (150g) & Fat (67g) remain identical across base, high, and low days
    expect(baseMacros).toEqual({ proteinG: 150, fatG: 67, carbsG: 299 });
    expect(highMacros.proteinG).toBe(baseMacros.proteinG);
    expect(highMacros.fatG).toBe(baseMacros.fatG);
    expect(highMacros.carbsG).toBe(baseMacros.carbsG + 50); // +200 kcal / 4 = +50g carbs
    expect(lowMacros.proteinG).toBe(baseMacros.proteinG);
    expect(lowMacros.fatG).toBe(baseMacros.fatG);
    expect(lowMacros.carbsG).toBe(baseMacros.carbsG - 50); // -200 kcal / 4 = -50g carbs
  });

  it('persists calorie_cycling via PATCH /api/settings/profile and reflects in dashboard/today, weeklyBudget, bootstrap, and calendar', async () => {
    const { app } = createTestContext();
    const headers = makeAuthHeaders(USER_A_ID);

    await onboardUser(app, headers, {
      name: 'Cycling Athlete',
      gender: 'male',
      birth_date: '1995-04-12',
      height_cm: 176,
      weight_kg: 75,
      baseline_activity_multiplier: 1.35,
      goal_type: 'CUT',
      calorie_adjustment: -350,
      protein_per_kg: 2.0,
      fat_ratio: 0.25,
    });

    const cyclingConfig: CalorieCyclingConfig = {
      enabled: true,
      mode: 'WEEKEND_BUFFER',
      dayOffsets: {
        mon: -100,
        tue: -100,
        wed: -100,
        thu: -100,
        fri: -100,
        sat: 250,
        sun: 250,
      },
      trainingDayOffset: 200,
      restDayOffset: -150,
      trainingDays: ['mon', 'wed', 'fri', 'sat'],
    };

    const patchRes = await app.request('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        name: 'Cycling Athlete',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.35,
        goal_type: 'CUT',
        calorie_adjustment: -350,
        protein_per_kg: 2.0,
        fat_ratio: 0.25,
        calorie_cycling: cyclingConfig,
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchedMe = (await patchRes.json()) as MeResponseDTO;
    expect(patchedMe.goal?.calorieCycling).toEqual(cyclingConfig);

    // Log a meal on Monday 2026-10-12 and verify Monday vs Saturday targets
    const mealRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        itemName: 'Chicken Rice Bowl',
        mealType: 'lunch',
        calories: 650,
        proteinG: 50,
        carbsG: 75,
        fatG: 15,
        loggedDate: '2026-10-12',
      }),
    });
    expect(mealRes.status).toBe(201);

    const monDashRes = await app.request('/api/dashboard/today?date=2026-10-12', { headers });
    expect(monDashRes.status).toBe(200);
    const monDash = (await monDashRes.json()) as DashboardTodayResponse;

    const monBaseTarget = monDash.energy.dynamicTdee + monDash.energy.calorieAdjustment;
    expect(monDash.energy.cyclingOffset).toBe(-100);
    expect(monDash.energy.cyclingDayType).toBe('low');
    expect(monDash.energy.cyclingLabel).toBe('Weekday Save (-100 kcal)');
    expect(monDash.energy.targetCalories).toBe(monBaseTarget - 100);

    expect(monDash.weeklyBudget).toBeDefined();
    expect(monDash.weeklyBudget!.weekStartDate).toBe('2026-10-12');
    expect(monDash.weeklyBudget!.weekEndDate).toBe('2026-10-18');
    expect(monDash.weeklyBudget!.cyclingEnabled).toBe(true);
    expect(monDash.weeklyBudget!.cyclingMode).toBe('WEEKEND_BUFFER');
    expect(monDash.weeklyBudget!.days).toHaveLength(7);
    expect(monDash.weeklyBudget!.days[0].isToday).toBe(true);
    expect(monDash.weeklyBudget!.days[0].cyclingOffset).toBe(-100);
    expect(monDash.weeklyBudget!.days[0].consumedCalories).toBe(650);
    expect(monDash.weeklyBudget!.days[5].cyclingOffset).toBe(250);
    expect(monDash.weeklyBudget!.days[6].cyclingOffset).toBe(250);
    expect(monDash.weeklyBudget!.weeklyConsumedCalories).toBe(650);
    expect(monDash.weeklyBudget!.weeklyTargetCalories).toBe(
      monDash.weeklyBudget!.days.reduce((sum, d) => sum + d.targetCalories, 0),
    );
    // Net weekly offset for -100*5 + 250*2 is 0, so weeklyTarget equals 7 * baseTarget
    expect(monDash.weeklyBudget!.weeklyTargetCalories).toBe(monBaseTarget * 7);

    // Saturday 2026-10-17 (+250 kcal): protein & fat targets stay identical to Monday, carbs rise!
    const satDashRes = await app.request('/api/dashboard/today?date=2026-10-17', { headers });
    expect(satDashRes.status).toBe(200);
    const satDash = (await satDashRes.json()) as DashboardTodayResponse;
    expect(satDash.energy.cyclingOffset).toBe(250);
    expect(satDash.energy.cyclingDayType).toBe('high');
    expect(satDash.energy.cyclingLabel).toBe('Weekend Buffer (+250 kcal)');
    expect(satDash.energy.targetCalories).toBe(monBaseTarget + 250);
    expect(satDash.macros.protein.target).toBe(monDash.macros.protein.target);
    expect(satDash.macros.fat.target).toBe(monDash.macros.fat.target);
    expect(satDash.macros.carbs.target).toBeGreaterThan(monDash.macros.carbs.target);

    // Bootstrap includes weeklyBudget
    const bootRes = await app.request('/api/dashboard/bootstrap?days=30&date=2026-10-12', {
      headers,
    });
    expect(bootRes.status).toBe(200);
    const boot = (await bootRes.json()) as DashboardBootstrapResponse;
    expect(boot.dashboard?.weeklyBudget?.days).toHaveLength(7);
    expect(boot.dashboard?.energy.cyclingOffset).toBe(-100);

    // Monthly calendar reflects cycling daily targets (Sat target - Mon target = 350 kcal)
    const calRes = await app.request('/api/dashboard/calendar?month=2026-10', { headers });
    expect(calRes.status).toBe(200);
    const cal = (await calRes.json()) as MonthlyCalendarResponse;
    const calMon = cal.days.find((d) => d.date === '2026-10-12')!;
    const calSat = cal.days.find((d) => d.date === '2026-10-17')!;
    expect(calMon.targetCalories).toBe(monDash.energy.targetCalories);
    expect(calSat.targetCalories).toBe(satDash.energy.targetCalories);
    expect(calSat.targetCalories - calMon.targetCalories).toBe(350);

    // Switch to TRAINING_REST and verify a logged workout overrides a scheduled rest day
    const trainingPatch = await app.request('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        name: 'Cycling Athlete',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.35,
        goal_type: 'CUT',
        calorie_adjustment: -350,
        protein_per_kg: 2.0,
        fat_ratio: 0.25,
        calorie_cycling: {
          enabled: true,
          mode: 'TRAINING_REST',
          dayOffsets: ZERO_OFFSETS,
          trainingDayOffset: 200,
          restDayOffset: -150,
          trainingDays: ['mon', 'wed', 'fri', 'sat'],
        },
      }),
    });
    expect(trainingPatch.status).toBe(200);

    // Tuesday 2026-10-13 starts as scheduled Rest Low (-150)
    const tueBeforeRes = await app.request('/api/dashboard/today?date=2026-10-13', { headers });
    const tueBefore = (await tueBeforeRes.json()) as DashboardTodayResponse;
    expect(tueBefore.energy.cyclingOffset).toBe(-150);
    expect(tueBefore.energy.cyclingDayType).toBe('low');

    // Logging a workout on Tuesday overrides it to Training High (+200)
    const woRes = await app.request('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        activityName: 'Zone 2 Run',
        category: 'cardio',
        durationMin: 40,
        activeCalories: 350,
        intensity: 'moderate',
        loggedDate: '2026-10-13',
      }),
    });
    expect(woRes.status).toBe(201);

    const tueAfterRes = await app.request('/api/dashboard/today?date=2026-10-13', { headers });
    const tueAfter = (await tueAfterRes.json()) as DashboardTodayResponse;
    expect(tueAfter.energy.cyclingOffset).toBe(200);
    expect(tueAfter.energy.cyclingDayType).toBe('high');
    expect(tueAfter.energy.cyclingLabel).toBe('Training High (+200 kcal)');
    expect(tueAfter.energy.targetCalories).toBe(
      tueAfter.energy.dynamicTdee + tueAfter.energy.calorieAdjustment + 200,
    );
  });
});

describe('Phase 6: Adaptive TDEE & Weekly AI Nutrition Coach (Unit Logic)', () => {
  const weekStartDate = '2026-10-12';
  const weekBounds = getWeekBounds(weekStartDate);
  const profile = makeProfile();

  it('computes INSUFFICIENT_DATA when <5 days logged or previous week weight is missing', () => {
    const metricsUpToWeekEnd = [
      makeMetric('2026-10-08', 80.0),
      makeMetric('2026-10-14', 79.6),
    ];
    const nutritionForWeek = [
      makeMeal('2026-10-12', 1900, 150),
      makeMeal('2026-10-13', 1950, 155),
      makeMeal('2026-10-14', 2000, 160),
      makeMeal('2026-10-15', 1920, 148),
      // Supplement entries must NOT inflate daysLogged or avgIntakeCalories
      makeMeal('2026-10-16', 0, 0, {
        mealType: 'supplement',
        itemName: 'Creatine',
        supplementKey: 'creatine',
      }),
    ];

    const goal = makeGoal({ goalType: 'CUT', calorieAdjustment: -350 });
    const metrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal,
      metricsUpToWeekEnd,
      workoutsForWeek: [makeWorkout('2026-10-12', 400)],
      nutritionForWeek,
    });

    expect(metrics.weekStartDate).toBe('2026-10-12');
    expect(metrics.weekEndDate).toBe('2026-10-18');
    expect(metrics.daysLogged).toBe(4);
    expect(metrics.observedTdee).toBeNull();
    expect(metrics.supplementAdherencePct).toBe(13); // 1 supplement taken / (4 days * 2 supps) = 12.5 -> 13

    const rec = evaluateAdaptiveAdjustment(metrics, goal);
    expect(rec).toEqual({
      direction: 'MAINTAIN',
      deltaKcal: 0,
      currentCalorieAdjustment: -350,
      suggestedCalorieAdjustment: -350,
      reasonCode: 'INSUFFICIENT_DATA',
      canApply: false,
    });

    // 5 days logged, but NO prior week weight -> still INSUFFICIENT_DATA
    const noPriorMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal,
      metricsUpToWeekEnd: [makeMetric('2026-10-14', 79.6)],
      workoutsForWeek: [],
      nutritionForWeek: weekBounds.dates.slice(0, 5).map((d) => makeMeal(d, 2000, 160)),
    });
    expect(noPriorMetrics.daysLogged).toBe(5);
    expect(noPriorMetrics.previousWeightMa7).toBeNull();
    expect(evaluateAdaptiveAdjustment(noPriorMetrics, goal).reasonCode).toBe(
      'INSUFFICIENT_DATA',
    );
  });

  it('evaluates CUT_TOO_SLOW (-125 kcal), CUT_TOO_FAST (+125 kcal), BULK_TOO_SLOW (+125 kcal), ON_TRACK (0 kcal), and Apple Health sleep/RHR averages', () => {
    const fiveMeals = weekBounds.dates.slice(0, 5).map((d, idx) =>
      makeMeal(d, idx < 3 ? 2000 : 2100, 160),
    );
    const weekendMeal = makeMeal('2026-10-17', 2400, 160);
    const sixMeals = [...fiveMeals, weekendMeal];

    // 1) CUT_TOO_SLOW: 80.00 -> 79.90 (-0.13%, > -0.2%) + Apple Health sleep & RHR
    const cutSlowGoal = makeGoal({ goalType: 'CUT', calorieAdjustment: -350 });
    const cutSlowMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal: cutSlowGoal,
      metricsUpToWeekEnd: [
        makeMetric('2026-10-08', 80.0),
        makeMetric('2026-10-14', 79.9, { sleepHours: 7.5, restingHr: 54 }),
        makeMetric('2026-10-16', 79.9, { sleepHours: 6.5, restingHr: 58 }),
      ],
      workoutsForWeek: [makeWorkout('2026-10-12', 450), makeWorkout('2026-10-15', 350)],
      nutritionForWeek: sixMeals,
    });
    expect(cutSlowMetrics.daysLogged).toBe(6);
    expect(cutSlowMetrics.weightDeltaKg).toBe(-0.1);
    expect(cutSlowMetrics.weightDeltaPct).toBe(-0.12);
    expect(cutSlowMetrics.weekdayAvgCalories).toBe(Math.round((2000 * 3 + 2100 * 2) / 5));
    expect(cutSlowMetrics.weekendAvgCalories).toBe(2400);
    expect(cutSlowMetrics.avgSleepHours).toBe(7);
    expect(cutSlowMetrics.avgRestingHr).toBe(56);
    expect(cutSlowMetrics.observedTdee).toBe(
      Math.round(cutSlowMetrics.avgIntakeCalories - (-0.1 * 7700) / 7),
    );
    expect(evaluateAdaptiveAdjustment(cutSlowMetrics, cutSlowGoal)).toEqual({
      direction: 'DECREASE',
      deltaKcal: -125,
      currentCalorieAdjustment: -350,
      suggestedCalorieAdjustment: -475,
      reasonCode: 'CUT_TOO_SLOW',
      canApply: true,
    });

    // 2) CUT_TOO_FAST: 80.00 -> 79.00 (-1.25%, < -0.9%) -> +125 kcal
    const cutFastMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal: cutSlowGoal,
      metricsUpToWeekEnd: [
        makeMetric('2026-10-09', 80.0),
        makeMetric('2026-10-16', 79.0),
      ],
      workoutsForWeek: [],
      nutritionForWeek: fiveMeals,
    });
    expect(cutFastMetrics.weightDeltaPct).toBe(-1.25);
    expect(evaluateAdaptiveAdjustment(cutFastMetrics, cutSlowGoal)).toEqual({
      direction: 'INCREASE',
      deltaKcal: 125,
      currentCalorieAdjustment: -350,
      suggestedCalorieAdjustment: -225,
      reasonCode: 'CUT_TOO_FAST',
      canApply: true,
    });

    // 3) BULK_TOO_SLOW: 80.00 -> 80.00 (0%, < 0.1%) -> +125 kcal
    const bulkGoal = makeGoal({ goalType: 'BULK', calorieAdjustment: 250 });
    const bulkSlowMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal: bulkGoal,
      metricsUpToWeekEnd: [
        makeMetric('2026-10-09', 80.0),
        makeMetric('2026-10-16', 80.0),
      ],
      workoutsForWeek: [],
      nutritionForWeek: fiveMeals,
    });
    expect(bulkSlowMetrics.weightDeltaPct).toBe(0);
    expect(evaluateAdaptiveAdjustment(bulkSlowMetrics, bulkGoal)).toEqual({
      direction: 'INCREASE',
      deltaKcal: 125,
      currentCalorieAdjustment: 250,
      suggestedCalorieAdjustment: 375,
      reasonCode: 'BULK_TOO_SLOW',
      canApply: true,
    });

    // 4) ON_TRACK: CUT 80.00 -> 79.60 (-0.50%, between -0.2% and -0.9%) -> 0 kcal
    const onTrackMetrics = computeWeeklyCoachMetrics({
      weekStartDate,
      profile,
      goal: cutSlowGoal,
      metricsUpToWeekEnd: [
        makeMetric('2026-10-09', 80.0),
        makeMetric('2026-10-16', 79.6),
      ],
      workoutsForWeek: [],
      nutritionForWeek: fiveMeals,
    });
    expect(onTrackMetrics.weightDeltaPct).toBe(-0.5);
    expect(evaluateAdaptiveAdjustment(onTrackMetrics, cutSlowGoal)).toEqual({
      direction: 'MAINTAIN',
      deltaKcal: 0,
      currentCalorieAdjustment: -350,
      suggestedCalorieAdjustment: -350,
      reasonCode: 'ON_TRACK',
      canApply: false,
    });
  });

  it('generateWeeklyCoachNarrative falls back cleanly to DETERMINISTIC_FALLBACK when GEMINI_API_KEY is missing or Gemini fails', async () => {
    const metrics: WeeklyCoachMetricsDTO = {
      weekStartDate: '2026-10-12',
      weekEndDate: '2026-10-18',
      daysLogged: 6,
      avgIntakeCalories: 2050,
      avgTargetCalories: 2100,
      avgProteinG: 155,
      avgProteinTargetG: 160,
      proteinAdherencePct: 97,
      calorieAdherencePct: 98,
      totalActiveCalories: 800,
      workoutDays: 3,
      supplementAdherencePct: 83,
      weekdayAvgCalories: 1980,
      weekendAvgCalories: 2400,
      currentWeightMa7: 79.9,
      previousWeightMa7: 80.0,
      weightDeltaKg: -0.1,
      weightDeltaPct: -0.13,
      observedTdee: 2160,
      estimatedTdee: 2450,
      avgSleepHours: 6.2,
      avgRestingHr: 57,
    };
    const recommendation = evaluateAdaptiveAdjustment(metrics, makeGoal());
    const goal = makeGoal();

    // 1) Missing GEMINI_API_KEY (explicit empty string avoids reading process/env secret)
    const missingKeyNarrative = await generateWeeklyCoachNarrative(metrics, recommendation, goal, {
      apiKey: '',
    });
    expect(missingKeyNarrative.source).toBe('DETERMINISTIC_FALLBACK');
    expect(WeeklyCoachAiNarrativeSchema.safeParse(missingKeyNarrative).success).toBe(true);

    // 2) Upstream failure across all candidate models
    const failingGenerate: GeminiGenerateContentFn = async () => {
      throw new Error('Upstream 503');
    };
    const failedNarrative = await generateWeeklyCoachNarrative(metrics, recommendation, goal, {
      apiKey: 'dummy-test-key',
      generateContent: failingGenerate,
    });
    expect(failedNarrative.source).toBe('DETERMINISTIC_FALLBACK');
    expect(WeeklyCoachAiNarrativeSchema.safeParse(failedNarrative).success).toBe(true);

    // 3) Malformed JSON response across models also falls back cleanly
    const badJsonGenerate: GeminiGenerateContentFn = async () => ({
      text: '{invalid-json',
    });
    const badJsonNarrative = await generateWeeklyCoachNarrative(metrics, recommendation, goal, {
      apiKey: 'dummy-test-key',
      generateContent: badJsonGenerate,
    });
    expect(badJsonNarrative.source).toBe('DETERMINISTIC_FALLBACK');

    // 4) Valid Gemini response sets source = 'GEMINI'
    const validGenerate: GeminiGenerateContentFn = async () => ({
      text: JSON.stringify({
        weeklyScore: 88,
        headline: 'คุมโปรตีนดีเยี่ยม แต่แคลอรีเสาร์-อาทิตย์ขยับสูง',
        summary: 'สัปดาห์นี้บันทึกอาหาร 6 วัน เฉลี่ย 2050 kcal และโปรตีน 155g',
        wins: ['ทำโปรตีนได้ 97% ของเป้าหมาย'],
        bottlenecks: ['วันหยุดแคลอรีสูงกว่าวันธรรมดา +420 kcal'],
        actionPlan: ['ลดแคลอรี -125 kcal/วัน และเข้านอนให้ครบ 7 ชม.'],
        adjustmentRationale: 'น้ำหนักลง -0.13% ช้ากว่าเกณฑ์ จึงแนะนำปรับลง 125 kcal/วัน',
      }),
    });
    const geminiNarrative = await generateWeeklyCoachNarrative(metrics, recommendation, goal, {
      apiKey: 'dummy-test-key',
      generateContent: validGenerate,
    });
    expect(geminiNarrative.source).toBe('GEMINI');
    expect(geminiNarrative.weeklyScore).toBe(88);
  });
});

describe('Phase 6: Weekly Coach API Endpoints, Caching, Apply, Auth & Isolation', () => {
  it('supports GET /api/coach/weekly, cached/forced POST /generate, Apple Health recovery signals, and POST /apply updating targetCalories', async () => {
    let generatorCallCount = 0;
    const mockNarrativeGenerator: WeeklyCoachNarrativeFn = async (
      metrics,
      recommendation,
    ): Promise<WeeklyCoachAiNarrativeDTO> => {
      generatorCallCount += 1;
      return {
        weeklyScore: 84 + generatorCallCount,
        headline: `สรุปสัปดาห์ ${metrics.weekStartDate} (รอบที่ ${generatorCallCount})`,
        summary: `บันทึก ${metrics.daysLogged} วัน น้ำหนักเปลี่ยน ${metrics.weightDeltaPct ?? 0}%`,
        wins: ['บันทึกโภชนาการสม่ำเสมอ'],
        bottlenecks: ['อัตราการลดน้ำหนักช้ากว่าเกณฑ์เล็กน้อย'],
        actionPlan: ['ปรับเป้าหมายพลังงานตามคำแนะนำ'],
        adjustmentRationale: `ปรับ ${recommendation.deltaKcal} kcal/วัน`,
        source: 'GEMINI',
      };
    };

    const { app } = createTestContext({
      generateWeeklyCoachNarrative: mockNarrativeGenerator,
    });
    const userAHeaders = makeAuthHeaders(USER_A_ID);
    const userBHeaders = makeAuthHeaders(USER_B_ID);

    await onboardUser(app, userAHeaders, {
      name: 'Coach User A',
      weight_kg: 80,
      goal_type: 'CUT',
      calorie_adjustment: -350,
    });
    await onboardUser(app, userBHeaders, { name: 'Coach User B', weight_kg: 70 });

    const weekStart = '2026-10-12';
    const prevWeekDate = shiftIsoDate(weekStart, -2); // 2026-10-10

    // Seed prior week weight (80.0) and current week weights (80.0 -> -0.0%, CUT_TOO_SLOW)
    for (const entry of [
      { recordedDate: prevWeekDate, weightKg: 80.0 },
      { recordedDate: '2026-10-14', weightKg: 80.0 },
      { recordedDate: '2026-10-16', weightKg: 80.0 },
    ]) {
      const mRes = await app.request('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userAHeaders },
        body: JSON.stringify(entry),
      });
      expect(mRes.status).toBe(201);
    }

    // Sync Apple Health sleep_hours & resting_hr into the week via webhook
    const keyRes = await app.request('/api/settings/webhook-key', {
      method: 'POST',
      headers: userAHeaders,
    });
    expect(keyRes.status).toBe(201);
    const { api_key: apiKey } = (await keyRes.json()) as WebhookKeyResponse;

    for (const recovery of [
      { recorded_date: '2026-10-14', sleep_hours: 7.4, resting_hr: 55 },
      { recorded_date: '2026-10-16', sleep_hours: 6.6, resting_hr: 59 },
    ]) {
      const whRes = await app.request('/api/webhooks/apple-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(recovery),
      });
      expect(whRes.status).toBe(200);
    }

    // Log 5 days of meals in the week 2026-10-12..2026-10-16
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      const nRes = await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userAHeaders },
        body: JSON.stringify({
          itemName: `Meal ${date}`,
          mealType: 'lunch',
          calories: 2100,
          proteinG: 160,
          carbsG: 200,
          fatG: 65,
          loggedDate: date,
        }),
      });
      expect(nRes.status).toBe(201);
    }

    // 1) GET /api/coach/weekly returns live metrics + recommendation and report: null initially
    const statusBeforeRes = await app.request(`/api/coach/weekly?weekStart=${weekStart}`, {
      headers: userAHeaders,
    });
    expect(statusBeforeRes.status).toBe(200);
    const statusBefore = (await statusBeforeRes.json()) as WeeklyCoachStatusResponse;
    expect(statusBefore.report).toBeNull();
    expect(statusBefore.liveMetrics.daysLogged).toBe(5);
    expect(statusBefore.liveMetrics.avgSleepHours).toBe(7);
    expect(statusBefore.liveMetrics.avgRestingHr).toBe(57);
    expect(statusBefore.liveRecommendation).toEqual({
      direction: 'DECREASE',
      deltaKcal: -125,
      currentCalorieAdjustment: -350,
      suggestedCalorieAdjustment: -475,
      reasonCode: 'CUT_TOO_SLOW',
      canApply: true,
    });

    // Invalid weekStart returns 400
    const badWeekRes = await app.request('/api/coach/weekly?weekStart=not-a-date', {
      headers: userAHeaders,
    });
    expect(badWeekRes.status).toBe(400);

    // 2) First POST /api/coach/weekly/generate invokes Gemini mock once
    const gen1Res = await app.request('/api/coach/weekly/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ weekStart }),
    });
    expect(gen1Res.status).toBe(200);
    const report1 = (await gen1Res.json()) as WeeklyCoachReportDTO;
    expect(generatorCallCount).toBe(1);
    expect(report1.narrative.source).toBe('GEMINI');
    expect(report1.narrative.weeklyScore).toBe(85);
    expect(report1.appliedAt).toBeNull();

    // Second POST with force: false returns cached report without calling Gemini again
    const gen2Res = await app.request('/api/coach/weekly/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ weekStart, force: false }),
    });
    expect(gen2Res.status).toBe(200);
    const report2 = (await gen2Res.json()) as WeeklyCoachReportDTO;
    expect(generatorCallCount).toBe(1);
    expect(report2.id).toBe(report1.id);
    expect(report2.generatedAt).toBe(report1.generatedAt);

    // Third POST with force: true regenerates
    const gen3Res = await app.request('/api/coach/weekly/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ weekStart, force: true }),
    });
    expect(gen3Res.status).toBe(200);
    const report3 = (await gen3Res.json()) as WeeklyCoachReportDTO;
    expect(generatorCallCount).toBe(2);
    expect(report3.narrative.weeklyScore).toBe(86);

    // GET /api/coach/weekly now includes the persisted report
    const statusAfterGenRes = await app.request(`/api/coach/weekly?weekStart=${weekStart}`, {
      headers: userAHeaders,
    });
    expect(statusAfterGenRes.status).toBe(200);
    const statusAfterGen = (await statusAfterGenRes.json()) as WeeklyCoachStatusResponse;
    expect(statusAfterGen.report?.id).toBe(report3.id);

    // 3) User B isolation: User B sees report: null and gets 404 applying User A's reportId
    const userBStatusRes = await app.request(`/api/coach/weekly?weekStart=${weekStart}`, {
      headers: userBHeaders,
    });
    expect(userBStatusRes.status).toBe(200);
    expect(((await userBStatusRes.json()) as WeeklyCoachStatusResponse).report).toBeNull();

    const userBApplyRes = await app.request('/api/coach/weekly/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userBHeaders },
      body: JSON.stringify({ reportId: report3.id }),
    });
    expect(userBApplyRes.status).toBe(404);

    // 4) POST /api/coach/weekly/apply updates calorieAdjustment and immediately lowers GET /api/dashboard/today targetCalories
    const dashBeforeRes = await app.request('/api/dashboard/today?date=2026-10-18', {
      headers: userAHeaders,
    });
    expect(dashBeforeRes.status).toBe(200);
    const dashBefore = (await dashBeforeRes.json()) as DashboardTodayResponse;
    expect(dashBefore.energy.calorieAdjustment).toBe(-350);

    const applyRes = await app.request('/api/coach/weekly/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ reportId: report3.id }),
    });
    expect(applyRes.status).toBe(200);
    const applied = (await applyRes.json()) as ApplyWeeklyCoachResponse;
    expect(applied.report.appliedAt).not.toBeNull();
    expect(applied.me.goal?.calorieAdjustment).toBe(-475);

    const dashAfterRes = await app.request('/api/dashboard/today?date=2026-10-18', {
      headers: userAHeaders,
    });
    expect(dashAfterRes.status).toBe(200);
    const dashAfter = (await dashAfterRes.json()) as DashboardTodayResponse;
    expect(dashAfter.energy.calorieAdjustment).toBe(-475);
    expect(dashAfter.energy.targetCalories).toBe(dashBefore.energy.targetCalories - 125);
  });

  it('gracefully falls back to DETERMINISTIC_FALLBACK on POST /api/coach/weekly/generate when Gemini fails, enforces 401/404/400 guards', async () => {
    const failingRouteNarrative: WeeklyCoachNarrativeFn = (metrics, recommendation, goal) =>
      generateWeeklyCoachNarrative(metrics, recommendation, goal, {
        apiKey: 'dummy-test-key',
        generateContent: async () => {
          throw new Error('Simulated Gemini outage');
        },
      });

    const { app } = createTestContext({
      generateWeeklyCoachNarrative: failingRouteNarrative,
    });

    // Strict 401 auth on all /api/coach/weekly* endpoints
    const unauthRoutes: Array<{ path: string; method: 'GET' | 'POST'; body?: string }> = [
      { path: '/api/coach/weekly', method: 'GET' },
      {
        path: '/api/coach/weekly/generate',
        method: 'POST',
        body: JSON.stringify({ weekStart: '2026-10-12' }),
      },
      {
        path: '/api/coach/weekly/apply',
        method: 'POST',
        body: JSON.stringify({ reportId: 'coach-missing' }),
      },
    ];
    for (const route of unauthRoutes) {
      const res = await app.request(route.path, {
        method: route.method,
        ...(route.body
          ? { headers: { 'Content-Type': 'application/json' }, body: route.body }
          : {}),
      });
      expect(res.status).toBe(401);
    }

    // 404 when un-onboarded user hits coach endpoints
    const unonboardedHeaders = makeAuthHeaders(USER_UNONBOARDED_ID);
    const unonboardedGet = await app.request('/api/coach/weekly', {
      headers: unonboardedHeaders,
    });
    expect(unonboardedGet.status).toBe(404);

    // Seed user generating on a week with <5 days falls back to DETERMINISTIC_FALLBACK and blocks apply (400)
    const userAHeaders = makeAuthHeaders(USER_A_ID);
    await onboardUser(app, userAHeaders, { name: 'Fallback User' });

    const genFallbackRes = await app.request('/api/coach/weekly/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ weekStart: '2026-10-12' }),
    });
    expect(genFallbackRes.status).toBe(200);
    const fallbackReport = (await genFallbackRes.json()) as WeeklyCoachReportDTO;
    expect(fallbackReport.narrative.source).toBe('DETERMINISTIC_FALLBACK');
    expect(fallbackReport.recommendation.reasonCode).toBe('INSUFFICIENT_DATA');
    expect(fallbackReport.recommendation.canApply).toBe(false);
    expect(WeeklyCoachAiNarrativeSchema.safeParse(fallbackReport.narrative).success).toBe(true);

    // Applying a non-applicable report returns 400
    const applyBlockedRes = await app.request('/api/coach/weekly/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({ reportId: fallbackReport.id }),
    });
    expect(applyBlockedRes.status).toBe(400);
  });
});
