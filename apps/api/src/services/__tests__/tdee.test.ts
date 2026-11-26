import { describe, expect, it } from 'bun:test';
import type {
  BodyMetricDTO,
  DashboardTodayResponse,
  MetricsTrendsResponse,
  NutritionLogDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import { createApp } from '../../app';
import { InMemoryHealthRepository, SEED_USER_ID } from '../../db/repository';
import { signHs256Jwt } from '../../middleware/auth';
import {
  calculateAge,
  calculateBmr,
  calculateDynamicTdee,
  calculateMacroTargets,
  calculateTargetCalories,
  evaluateReadiness,
} from '../tdee.service';
import { computeBodyTrends } from '../trends.service';

describe('TDEE, BMR, Macros & Readiness Calculations', () => {
  it('computes age accurately around birth month and day', () => {
    expect(calculateAge('1995-04-12', '2026-04-11')).toBe(30);
    expect(calculateAge('1995-04-12', '2026-04-12')).toBe(31);
    expect(calculateAge('1995-04-12', '2026-11-25')).toBe(31);
  });

  it('uses Katch-McArdle exact math when bodyFatPct is provided', () => {
    // LBM = 75 * (1 - 20 / 100) = 60.0 kg -> BMR = 370 + 21.6 * 60 = 1666
    const exact = calculateBmr({
      weightKg: 75,
      heightCm: 176,
      age: 31,
      sex: 'male',
      bodyFatPct: 20,
    });
    expect(exact).toEqual({
      bmr: 1666,
      formula: 'katch_mcardle',
      leanBodyMassKg: 60,
    });

    // LBM = 74.9 * (1 - 16.5 / 100) = 62.5415 -> 62.54 kg, BMR = round(370 + 21.6 * 62.5415) = 1721
    const athletic = calculateBmr({
      weightKg: 74.9,
      heightCm: 176,
      age: 31,
      sex: 'male',
      bodyFatPct: 16.5,
    });
    expect(athletic).toEqual({
      bmr: 1721,
      formula: 'katch_mcardle',
      leanBodyMassKg: 62.54,
    });
  });

  it('falls back to Mifflin-St Jeor exact math for male, female, and other when bodyFatPct is null', () => {
    // Male: 10*75 + 6.25*176 - 5*30 + 5 = 750 + 1100 - 150 + 5 = 1705
    const male = calculateBmr({
      weightKg: 75,
      heightCm: 176,
      age: 30,
      sex: 'male',
      bodyFatPct: null,
    });
    expect(male).toEqual({
      bmr: 1705,
      formula: 'mifflin_st_jeor',
      leanBodyMassKg: null,
    });

    // Female: 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25 -> 1330
    const female = calculateBmr({
      weightKg: 60,
      heightCm: 165,
      age: 28,
      sex: 'female',
      bodyFatPct: null,
    });
    expect(female).toEqual({
      bmr: 1330,
      formula: 'mifflin_st_jeor',
      leanBodyMassKg: null,
    });

    // Other: 10*70 + 6.25*170 - 5*30 - 78 = 700 + 1062.5 - 150 - 78 = 1534.5 -> 1535
    const other = calculateBmr({
      weightKg: 70,
      heightCm: 170,
      age: 30,
      sex: 'other',
      bodyFatPct: undefined,
    });
    expect(other).toEqual({
      bmr: 1535,
      formula: 'mifflin_st_jeor',
      leanBodyMassKg: null,
    });
  });

  it('computes Dynamic TDEE as (BMR * baselineActivityMultiplier) + activeCalories across modes', () => {
    const restDay = calculateDynamicTdee({
      bmr: 1700,
      baselineActivityMultiplier: 1.35,
      activeCalories: 0,
    });
    expect(restDay).toEqual({
      baselineTdee: 2295,
      effectiveActiveCalories: 0,
      dynamicTdee: 2295,
    });

    const trainingDay = calculateDynamicTdee({
      bmr: 1700,
      baselineActivityMultiplier: 1.35,
      activeCalories: 485,
      tdeeMode: 'MANUAL_WORKOUT_DYNAMIC',
    });
    expect(trainingDay).toEqual({
      baselineTdee: 2295,
      effectiveActiveCalories: 485,
      dynamicTdee: 2780,
    });

    const appleWatchDay = calculateDynamicTdee({
      bmr: 1700,
      baselineActivityMultiplier: 1.1,
      activeCalories: 620,
      tdeeMode: 'APPLE_HEALTH_DYNAMIC',
    });
    expect(appleWatchDay).toEqual({
      baselineTdee: 1870,
      effectiveActiveCalories: 620,
      dynamicTdee: 2490,
    });

    const fixedStaticDay = calculateDynamicTdee({
      bmr: 1700,
      baselineActivityMultiplier: 1.55,
      activeCalories: 620,
      tdeeMode: 'FIXED_STATIC',
    });
    expect(fixedStaticDay).toEqual({
      baselineTdee: 2635,
      effectiveActiveCalories: 0,
      dynamicTdee: 2635,
    });
  });

  it('computes Target Calories across CUT, MAINTAIN, BULK and enforces the 1200 kcal floor', () => {
    const dynamicTdee = 2780;

    // CUT (-350)
    expect(calculateTargetCalories({ dynamicTdee, calorieAdjustment: -350 })).toBe(2430);
    // MAINTAIN (0)
    expect(calculateTargetCalories({ dynamicTdee, calorieAdjustment: 0 })).toBe(2780);
    // BULK (+300)
    expect(calculateTargetCalories({ dynamicTdee, calorieAdjustment: 300 })).toBe(3080);
    // 1200 kcal safety floor
    expect(calculateTargetCalories({ dynamicTdee: 1500, calorieAdjustment: -500 })).toBe(1200);
  });

  it('computes automatic macro targets with fixed protein, fatRatio share, and remaining carbs (min 0)', () => {
    // protein = 75 * 2.0 = 150g (600 kcal)
    // fat = round((2400 * 0.25) / 9) = round(66.67) = 67g (603 kcal)
    // carbs = round((2400 - 600 - 603) / 4) = round(299.25) = 299g
    expect(
      calculateMacroTargets({
        targetCalories: 2400,
        weightKg: 75,
        proteinPerKg: 2.0,
        fatRatio: 0.25,
      }),
    ).toEqual({
      proteinG: 150,
      fatG: 67,
      carbsG: 299,
    });

    // Low calorie + high body weight clamps carbs to 0 instead of going negative
    expect(
      calculateMacroTargets({
        targetCalories: 1200,
        weightKg: 110,
        proteinPerKg: 2.2,
        fatRatio: 0.35,
      }),
    ).toEqual({
      proteinG: 242,
      fatG: 47,
      carbsG: 0,
    });
  });

  it('evaluates readiness across optimal, moderate, and overload states', () => {
    const optimal = evaluateReadiness({
      consumedCalories: 2300,
      targetCalories: 2400,
      consumedProteinG: 145,
      targetProteinG: 150,
      activeCalories: 420,
      goalType: 'CUT',
    });
    expect(optimal.status).toBe('optimal');
    expect(optimal.badge).toBe('Optimal Fuel');
    expect(optimal.score).toBe(100);
    expect(optimal.trainingLoadLevel).toBe('moderate');

    const moderate = evaluateReadiness({
      consumedCalories: 1320,
      targetCalories: 2400,
      consumedProteinG: 90,
      targetProteinG: 150,
      activeCalories: 250,
      goalType: 'CUT',
    });
    expect(moderate.status).toBe('moderate');
    expect(moderate.badge).toBe('Fuel Window Open');
    expect(moderate.trainingLoadLevel).toBe('light');

    const calorieOverload = evaluateReadiness({
      consumedCalories: 3000,
      targetCalories: 2400,
      consumedProteinG: 160,
      targetProteinG: 150,
      activeCalories: 200,
      goalType: 'CUT',
    });
    expect(calorieOverload.status).toBe('overload');
    expect(calorieOverload.badge).toBe('Cut Overrun');

    const underFueledOverload = evaluateReadiness({
      consumedCalories: 700,
      targetCalories: 2600,
      consumedProteinG: 45,
      targetProteinG: 160,
      activeCalories: 720,
      goalType: 'MAINTAIN',
    });
    expect(underFueledOverload.status).toBe('overload');
    expect(underFueledOverload.badge).toBe('Under-Fueled');
    expect(underFueledOverload.trainingLoadLevel).toBe('high');
  });
});

describe('Body Composition Trends & 7-Day Moving Average', () => {
  const weights = [80.0, 79.0, 78.0, 77.0, 76.0, 75.0, 74.0, 73.0, 72.0, 71.0];

  const makeMetrics = (): BodyMetricDTO[] =>
    weights.map((weightKg, i) => ({
      id: `m-${i + 1}`,
      userId: 'user-1',
      recordedDate: `2026-11-${String(i + 1).padStart(2, '0')}`,
      weightKg,
      bodyFatPct: Number((20 - i * 0.2).toFixed(1)),
      skeletalMuscleMassKg: Number((34 + i * 0.1).toFixed(1)),
      notes: null,
    }));

  it('computes expanding 7-day moving average for <7 days and true 7-day rolling window afterwards', () => {
    // Pass reversed array to verify chronological sorting as well
    const metrics = makeMetrics().reverse();
    const res = computeBodyTrends(metrics, 10);

    expect(res.days).toBe(10);
    expect(res.points).toHaveLength(10);

    // Day 1 (<7): [80] -> 80.0
    expect(res.points[0].weightMa7).toBe(80);
    // Day 3 (<7): [80, 79, 78] -> 79.0
    expect(res.points[2].weightMa7).toBe(79);
    // Day 6 (<7): [80, 79, 78, 77, 76, 75] -> 77.5
    expect(res.points[5].weightMa7).toBe(77.5);
    // Day 7 (full 7): [80..74] -> 77.0
    expect(res.points[6].weightMa7).toBe(77);
    // Day 8 (rolling 7): [79..73] -> 76.0
    expect(res.points[7].weightMa7).toBe(76);
    // Day 10 (rolling 7): [77..71] -> 74.0
    expect(res.points[9].weightMa7).toBe(74);

    expect(res.summary).toEqual({
      startWeightKg: 80,
      currentWeightKg: 71,
      weightDeltaKg: -9,
      startBodyFatPct: 20,
      currentBodyFatPct: 18.2,
      bodyFatDeltaPct: -1.8,
      startMuscleKg: 34,
      currentMuscleKg: 34.9,
      muscleDeltaKg: 0.9,
    });
  });

  it('slices trailing window while preserving 7-day MA computed from prior history', () => {
    const res = computeBodyTrends(makeMetrics(), 5);
    expect(res.points).toHaveLength(5);
    expect(res.points[0].date).toBe('2026-11-06');
    // Day 6 MA still uses days 1..6 (77.5), not just the sliced window
    expect(res.points[0].weightMa7).toBe(77.5);
    expect(res.points[4].date).toBe('2026-11-10');
    expect(res.points[4].weightMa7).toBe(74);
    expect(res.summary.weightDeltaKg).toBe(-4);
  });

  it('handles empty metrics gracefully', () => {
    const empty = computeBodyTrends([], 30);
    expect(empty.points).toEqual([]);
    expect(empty.summary.weightDeltaKg).toBe(0);
    expect(empty.summary.bodyFatDeltaPct).toBeNull();
  });
});

describe('Hono API Integration Tests (app.request)', () => {
  const TEST_JWT_SECRET = 'test-jwt-secret-tdee-integration-0123456789';
  const createTestApp = () =>
    createApp(new InMemoryHealthRepository(), { jwtSecret: TEST_JWT_SECRET });
  const makeAuthHeaders = (userId: string = SEED_USER_ID) => ({
    Authorization: `Bearer ${signHs256Jwt({ sub: userId }, TEST_JWT_SECRET)}`,
  });

  it('GET /api/health returns ok and memory storageMode', async () => {
    const app = createTestApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      storageMode: string;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(body.storageMode).toBe('memory');
    expect(typeof body.timestamp).toBe('string');
  });

  it('GET /api/dashboard/today returns full hydrated dashboard payload and validates date query', async () => {
    const app = createTestApp();
    const headers = makeAuthHeaders();
    const res = await app.request('/api/dashboard/today', { headers });
    expect(res.status).toBe(200);

    const data = (await res.json()) as DashboardTodayResponse;
    expect(data.storageMode).toBe('memory');
    expect(data.energy.bmrFormula).toBe('katch_mcardle');
    expect(data.energy.dynamicTdee).toBe(
      data.energy.baselineTdee + data.energy.activeCalories,
    );
    expect(data.supplements).toHaveLength(5);
    expect(data.supplements.filter((s) => s.taken)).toHaveLength(3);
    expect(data.meals.length).toBeGreaterThan(0);
    expect(data.workouts.length).toBeGreaterThan(0);

    const badDateRes = await app.request('/api/dashboard/today?date=invalid-date', {
      headers,
    });
    expect(badDateRes.status).toBe(400);
  });

  it('GET /api/metrics/trends?days=30 returns 30-day body trends and rejects out-of-range days', async () => {
    const app = createTestApp();
    const headers = makeAuthHeaders();
    const res = await app.request('/api/metrics/trends?days=30', { headers });
    expect(res.status).toBe(200);

    const trends = (await res.json()) as MetricsTrendsResponse;
    expect(trends.days).toBe(30);
    expect(trends.points).toHaveLength(30);
    expect(typeof trends.points[0].weightMa7).toBe('number');
    expect(trends.summary.weightDeltaKg).toBeLessThan(0);

    const badDaysRes = await app.request('/api/metrics/trends?days=3', { headers });
    expect(badDaysRes.status).toBe(400);
  });

  it('POST /api/nutrition logs a meal, rejects invalid payloads with 400, and supports deletion', async () => {
    const app = createTestApp();
    const authHeaders = makeAuthHeaders();

    const invalidRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        itemName: '',
        mealType: 'dinner',
        calories: -50,
        proteinG: 20,
        carbsG: 30,
        fatG: 5,
      }),
    });
    expect(invalidRes.status).toBe(400);

    const beforeRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const before = (await beforeRes.json()) as DashboardTodayResponse;

    const createRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        itemName: 'Grilled Salmon & Rice',
        mealType: 'dinner',
        calories: 620,
        proteinG: 44,
        carbsG: 58,
        fatG: 22,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as NutritionLogDTO;
    expect(created.itemName).toBe('Grilled Salmon & Rice');
    expect(created.calories).toBe(620);

    const afterRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const after = (await afterRes.json()) as DashboardTodayResponse;
    expect(after.energy.consumedCalories).toBe(before.energy.consumedCalories + 620);
    expect(after.macros.protein.consumed).toBeCloseTo(
      before.macros.protein.consumed + 44,
      1,
    );

    const deleteRes = await app.request(`/api/nutrition/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(deleteRes.status).toBe(200);

    const missingDeleteRes = await app.request(`/api/nutrition/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(missingDeleteRes.status).toBe(404);
  });

  it('POST /api/workouts increases Dynamic TDEE and Target Calories immediately', async () => {
    const app = createTestApp();
    const authHeaders = makeAuthHeaders();

    const beforeRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const before = (await beforeRes.json()) as DashboardTodayResponse;

    const addedActiveCalories = 420;
    const createRes = await app.request('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        activityName: 'Evening Tempo Run',
        category: 'cardio',
        durationMin: 40,
        activeCalories: addedActiveCalories,
        intensity: 'high',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as WorkoutLogDTO;
    expect(created.activeCalories).toBe(addedActiveCalories);

    const afterRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const after = (await afterRes.json()) as DashboardTodayResponse;
    expect(after.energy.activeCalories).toBe(
      before.energy.activeCalories + addedActiveCalories,
    );
    expect(after.energy.dynamicTdee).toBe(
      before.energy.dynamicTdee + addedActiveCalories,
    );
    expect(after.energy.targetCalories).toBe(
      before.energy.targetCalories + addedActiveCalories,
    );
    expect(after.workouts.some((w) => w.id === created.id)).toBe(true);
  });

  it('POST /api/supplements/toggle toggles supplement taken state idempotently per click', async () => {
    const app = createTestApp();
    const authHeaders = makeAuthHeaders();

    const initialRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const initial = (await initialRes.json()) as DashboardTodayResponse;
    const targetSupp = initial.supplements.find((s) => !s.taken);
    expect(targetSupp).toBeDefined();
    const key = targetSupp!.key;

    // First toggle: false -> true
    const toggleOnRes = await app.request('/api/supplements/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ supplementKey: key }),
    });
    expect(toggleOnRes.status).toBe(200);
    const toggleOnBody = (await toggleOnRes.json()) as {
      supplementKey: string;
      taken: boolean;
    };
    expect(toggleOnBody.supplementKey).toBe(key);
    expect(toggleOnBody.taken).toBe(true);

    const midRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const mid = (await midRes.json()) as DashboardTodayResponse;
    expect(mid.supplements.find((s) => s.key === key)?.taken).toBe(true);

    // Second toggle: true -> false
    const toggleOffRes = await app.request('/api/supplements/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ supplementKey: key }),
    });
    expect(toggleOffRes.status).toBe(200);
    const toggleOffBody = (await toggleOffRes.json()) as {
      supplementKey: string;
      taken: boolean;
    };
    expect(toggleOffBody.taken).toBe(false);

    const endRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    const end = (await endRes.json()) as DashboardTodayResponse;
    expect(end.supplements.find((s) => s.key === key)?.taken).toBe(false);
  });

  it('POST /api/onboarding and PATCH /api/settings/profile persist tdee_mode and enforce FIXED_STATIC in dashboard', async () => {
    const app = createTestApp();
    const watchHeaders = makeAuthHeaders('11111111-1111-4111-8111-111111111111');

    const onboardRes = await app.request('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...watchHeaders },
      body: JSON.stringify({
        name: 'Watch Athlete',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        weight_kg: 75,
        baseline_activity_multiplier: 1.0,
        tdee_mode: 'APPLE_HEALTH_DYNAMIC',
        goal_type: 'CUT',
        calorie_adjustment: -350,
        protein_per_kg: 2.0,
        fat_ratio: 0.25,
      }),
    });
    expect(onboardRes.status).toBe(201);
    const onboarded = (await onboardRes.json()) as {
      onboarded: boolean;
      profile: { tdeeMode?: string; baselineActivityMultiplier: number } | null;
    };
    expect(onboarded.onboarded).toBe(true);
    expect(onboarded.profile?.tdeeMode).toBe('APPLE_HEALTH_DYNAMIC');
    expect(onboarded.profile?.baselineActivityMultiplier).toBe(1.0);

    const watchDashRes = await app.request('/api/dashboard/today', {
      headers: watchHeaders,
    });
    expect(watchDashRes.status).toBe(200);
    const watchDash = (await watchDashRes.json()) as DashboardTodayResponse;
    expect(watchDash.energy.tdeeMode).toBe('APPLE_HEALTH_DYNAMIC');

    const seedHeaders = makeAuthHeaders();
    const beforeSeedRes = await app.request('/api/dashboard/today', {
      headers: seedHeaders,
    });
    const beforeSeed = (await beforeSeedRes.json()) as DashboardTodayResponse;
    expect(beforeSeed.energy.activeCalories).toBeGreaterThan(0);
    expect(beforeSeed.energy.effectiveActiveCalories).toBe(
      beforeSeed.energy.activeCalories,
    );

    const switchRes = await app.request('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...seedHeaders },
      body: JSON.stringify({
        name: beforeSeed.profile.name,
        gender: beforeSeed.profile.sex,
        birth_date: beforeSeed.profile.birthDate,
        height_cm: beforeSeed.profile.heightCm,
        baseline_activity_multiplier: 1.55,
        tdee_mode: 'FIXED_STATIC',
        goal_type: beforeSeed.goal.goalType,
        calorie_adjustment: beforeSeed.goal.calorieAdjustment,
        protein_per_kg: beforeSeed.goal.proteinPerKg,
        fat_ratio: beforeSeed.goal.fatRatio,
      }),
    });
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as {
      profile: { tdeeMode?: string; baselineActivityMultiplier: number } | null;
    };
    expect(switchBody.profile?.tdeeMode).toBe('FIXED_STATIC');
    expect(switchBody.profile?.baselineActivityMultiplier).toBe(1.55);

    const afterSeedRes = await app.request('/api/dashboard/today', {
      headers: seedHeaders,
    });
    expect(afterSeedRes.status).toBe(200);
    const switched = (await afterSeedRes.json()) as DashboardTodayResponse;
    expect(switched.profile.tdeeMode).toBe('FIXED_STATIC');
    expect(switched.energy.tdeeMode).toBe('FIXED_STATIC');
    expect(switched.energy.activeCalories).toBe(beforeSeed.energy.activeCalories);
    expect(switched.energy.effectiveActiveCalories).toBe(0);
    expect(switched.energy.dynamicTdee).toBe(switched.energy.baselineTdee);
    expect(switched.energy.targetCalories).toBe(
      Math.max(
        1200,
        switched.energy.baselineTdee + switched.energy.calorieAdjustment,
      ),
    );
  });
});
