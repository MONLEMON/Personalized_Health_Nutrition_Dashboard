import { describe, expect, it } from 'bun:test';
import type {
  CopyYesterdayMealsResponse,
  DashboardBootstrapResponse,
  DashboardTodayResponse,
  LogSavedMealResponse,
  MonthlyCalendarResponse,
  NutritionLogDTO,
  SavedMealDTO,
  SavedMealsListResponse,
  WaterLogSummaryDTO,
} from '@health-dash/shared';
import type { Hono } from 'hono';
import { createApp } from '../../app';
import {
  calculateWaterTargetBreakdown,
  getBangkokDateString,
  InMemoryHealthRepository,
  SEED_USER_ID,
} from '../../db/repository';
import { shiftDateString } from '../../db/seed-data';
import { signHs256Jwt } from '../../middleware/auth';

const TEST_JWT_SECRET = 'test-phase8-features-jwt-secret-0123456789abcdef';
const USER_A_ID = 'aaaaaaaa-8888-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-8888-4bbb-8bbb-bbbbbbbbbbbb';

function createTestContext() {
  const today = getBangkokDateString();
  const repo = new InMemoryHealthRepository(today);
  const app = createApp(repo, { jwtSecret: TEST_JWT_SECRET });
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
    weight_kg: number;
    calorie_adjustment: number;
  }> = {},
) {
  const res = await app.request('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      name: 'Phase 8 Athlete',
      gender: 'male',
      birth_date: '1995-04-12',
      height_cm: 176,
      weight_kg: 75,
      baseline_activity_multiplier: 1.35,
      goal_type: 'CUT',
      calorie_adjustment: -350,
      protein_per_kg: 2.0,
      fat_ratio: 0.25,
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
}

describe('Phase 8: Saved Meals, Edit Meal, Copy Yesterday, and Hydration', () => {
  describe('Water target formula', () => {
    it('computes clamped baseMl, capped workoutBonusMl, and creatineBonusMl', () => {
      const noCreatine = calculateWaterTargetBreakdown({
        weightKg: 75,
        activeCalories: 0,
        supplementStack: [
          { key: 'omega3', name: 'Omega-3', dosage: '2g', timing: 'Lunch' },
        ],
      });
      // 75 * 35 = 2625 -> rounded to nearest 50 = 2650
      expect(noCreatine).toEqual({
        baseMl: 2650,
        workoutBonusMl: 0,
        creatineBonusMl: 0,
        targetMl: 2650,
      });

      const withCreatineAndWorkout = calculateWaterTargetBreakdown({
        weightKg: 75,
        activeCalories: 630,
        supplementStack: [
          { key: 'custom_crea', name: 'Creatine Monohydrate', dosage: '5g', timing: 'Post' },
        ],
      });
      // 630 * 0.5 = 315 -> nearest 50 = 300; creatine = +500
      expect(withCreatineAndWorkout).toEqual({
        baseMl: 2650,
        workoutBonusMl: 300,
        creatineBonusMl: 500,
        targetMl: 3450,
      });

      const clampedMinAndMaxBonus = calculateWaterTargetBreakdown({
        weightKg: 35, // 1225 -> clamped to 1500
        activeCalories: 3000, // 1500 -> capped at 1000
        supplementStack: [
          { key: 'creatine', name: 'Micronized Powder', dosage: '5g', timing: 'Daily' },
        ],
      });
      expect(clampedMinAndMaxBonus).toEqual({
        baseMl: 1500,
        workoutBonusMl: 1000,
        creatineBonusMl: 500,
        targetMl: 3000,
      });

      const clampedMaxBase = calculateWaterTargetBreakdown({
        weightKg: 160, // 5600 -> clamped to 4500
        activeCalories: 200,
        supplementStack: [],
      });
      expect(clampedMaxBase).toEqual({
        baseMl: 4500,
        workoutBonusMl: 100,
        creatineBonusMl: 0,
        targetMl: 4600,
      });
    });
  });

  describe('Edit Meal (PATCH /api/nutrition/:id)', () => {
    it('updates a non-supplement meal with decimal precision and recalculates dashboard totals', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      await onboardUser(app, headersA);

      const createRes = await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Chicken Rice',
          mealType: 'lunch',
          calories: 500,
          proteinG: 40,
          carbsG: 55,
          fatG: 12,
          loggedDate: today,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as NutritionLogDTO;

      const patchRes = await app.request(`/api/nutrition/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Double Chicken & Rice Bowl',
          mealType: 'dinner',
          calories: 645.5,
          proteinG: 54.5,
          carbsG: 68.2,
          fatG: 14.8,
        }),
      });
      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as NutritionLogDTO;
      expect(updated.id).toBe(created.id);
      expect(updated.itemName).toBe('Double Chicken & Rice Bowl');
      expect(updated.mealType).toBe('dinner');
      expect(updated.calories).toBe(645.5);
      expect(updated.proteinG).toBe(54.5);
      expect(updated.carbsG).toBe(68.2);
      expect(updated.fatG).toBe(14.8);
      expect(updated.loggedDate).toBe(today);

      const dashRes = await app.request(`/api/dashboard/today?date=${today}`, {
        headers: headersA,
      });
      expect(dashRes.status).toBe(200);
      const dash = (await dashRes.json()) as DashboardTodayResponse;
      expect(dash.energy.consumedCalories).toBe(646);
      expect(dash.macros.protein.consumed).toBe(54.5);
      expect(dash.meals).toHaveLength(1);
    });

    it('enforces auth, validation, user isolation, and rejects editing supplement rows (404)', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      const headersB = makeAuthHeaders(USER_B_ID);
      await onboardUser(app, headersA);
      await onboardUser(app, headersB);

      const createRes = await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'User A Oats',
          mealType: 'breakfast',
          calories: 400,
          proteinG: 30,
          carbsG: 50,
          fatG: 8,
          loggedDate: today,
        }),
      });
      const mealA = (await createRes.json()) as NutritionLogDTO;

      // Unauthenticated -> 401
      const unauthRes = await app.request(`/api/nutrition/${mealA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemName: 'Hacked',
          mealType: 'breakfast',
          calories: 100,
          proteinG: 10,
          carbsG: 10,
          fatG: 1,
        }),
      });
      expect(unauthRes.status).toBe(401);

      // User B cannot edit User A's meal -> 404
      const crossUserRes = await app.request(`/api/nutrition/${mealA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headersB },
        body: JSON.stringify({
          itemName: 'Hacked',
          mealType: 'breakfast',
          calories: 100,
          proteinG: 10,
          carbsG: 10,
          fatG: 1,
        }),
      });
      expect(crossUserRes.status).toBe(404);

      // Invalid mealType 'supplement' -> 400
      const invalidRes = await app.request(`/api/nutrition/${mealA.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Invalid',
          mealType: 'supplement',
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
        }),
      });
      expect(invalidRes.status).toBe(400);

      // Toggle a supplement row and verify PATCH on that supplement log ID returns 404
      await app.request('/api/supplements/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ supplementKey: 'creatine', loggedDate: today }),
      });

      const listRes = await app.request(`/api/dashboard/today?date=${today}`, {
        headers: headersA,
      });
      const dash = (await listRes.json()) as DashboardTodayResponse;
      expect(dash.supplements.find((s) => s.key === 'creatine')?.taken).toBe(true);

      // Also verify seeded supplement row cannot be patched by SEED_USER_ID
      const patchSeedSupp = await app.request('/api/nutrition/nutrition-supp-creatine', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...makeAuthHeaders(SEED_USER_ID),
        },
        body: JSON.stringify({
          itemName: 'Edited Supp',
          mealType: 'snack',
          calories: 50,
          proteinG: 5,
          carbsG: 5,
          fatG: 1,
        }),
      });
      expect(patchSeedSupp.status).toBe(404);
    });
  });

  describe('Saved Meals CRUD, Multiplier Scaling, & Recent 14-day Deduplication', () => {
    it('supports creating, listing, logging with multiplier scaling, deleting, and strict ownership', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      const headersB = makeAuthHeaders(USER_B_ID);
      await onboardUser(app, headersA);
      await onboardUser(app, headersB);

      const createRes1 = await app.request('/api/nutrition/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          name: 'Salmon Poke Bowl',
          defaultMealType: 'lunch',
          calories: 620,
          proteinG: 42.5,
          carbsG: 65,
          fatG: 18.5,
          servingNote: '1 regular bowl',
        }),
      });
      expect(createRes1.status).toBe(201);
      const saved1 = (await createRes1.json()) as SavedMealDTO;
      expect(saved1.usageCount).toBe(0);
      expect(saved1.lastUsedAt).toBeNull();
      expect(saved1.servingNote).toBe('1 regular bowl');

      const createRes2 = await app.request('/api/nutrition/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          name: 'Greek Yogurt Parfait',
          defaultMealType: 'snack',
          calories: 250,
          proteinG: 22,
          carbsG: 26,
          fatG: 5,
          servingNote: null,
        }),
      });
      expect(createRes2.status).toBe(201);
      const saved2 = (await createRes2.json()) as SavedMealDTO;

      // Log saved2 with 1.5x multiplier and custom mealType
      const logRes = await app.request(`/api/nutrition/saved/${saved2.id}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          loggedDate: today,
          mealType: 'breakfast',
          multiplier: 1.5,
        }),
      });
      expect(logRes.status).toBe(201);
      const logged = (await logRes.json()) as LogSavedMealResponse;
      expect(logged.meal.itemName).toBe('Greek Yogurt Parfait');
      expect(logged.meal.mealType).toBe('breakfast');
      expect(logged.meal.calories).toBe(375);
      expect(logged.meal.proteinG).toBe(33);
      expect(logged.meal.carbsG).toBe(39);
      expect(logged.meal.fatG).toBe(7.5);
      expect(logged.meal.source).toBe('MANUAL');
      expect(logged.savedMeal.usageCount).toBe(1);
      expect(logged.savedMeal.lastUsedAt).not.toBeNull();

      // List saved meals for User A: saved2 (usageCount 1) comes before saved1 (usageCount 0)
      const listA = await app.request(`/api/nutrition/saved?date=${today}`, {
        headers: headersA,
      });
      expect(listA.status).toBe(200);
      const listBodyA = (await listA.json()) as SavedMealsListResponse;
      expect(listBodyA.savedMeals.map((s) => s.id)).toEqual([saved2.id, saved1.id]);

      // User B cannot see, log, or delete User A's saved meals
      const listB = await app.request(`/api/nutrition/saved?date=${today}`, {
        headers: headersB,
      });
      const listBodyB = (await listB.json()) as SavedMealsListResponse;
      expect(listBodyB.savedMeals).toHaveLength(0);

      const logWrongUser = await app.request(`/api/nutrition/saved/${saved1.id}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersB },
        body: JSON.stringify({ multiplier: 1 }),
      });
      expect(logWrongUser.status).toBe(404);

      const delWrongUser = await app.request(`/api/nutrition/saved/${saved1.id}`, {
        method: 'DELETE',
        headers: headersB,
      });
      expect(delWrongUser.status).toBe(404);

      // User A deletes saved1
      const delOwner = await app.request(`/api/nutrition/saved/${saved1.id}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delOwner.status).toBe(200);
      expect(await delOwner.json()).toEqual({ deleted: true, id: saved1.id });

      const delAgain = await app.request(`/api/nutrition/saved/${saved1.id}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delAgain.status).toBe(404);
    });

    it('deduplicates recent meals case-insensitively over last 14 days, skips supplements, and caps at 12', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      await onboardUser(app, headersA);

      // Supplement must never appear in recentMeals
      await app.request('/api/supplements/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ supplementKey: 'creatine', loggedDate: today }),
      });

      // Older than 14-day window -> excluded
      const oldDate = shiftDateString(today, -15);
      await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Ancient Meal',
          mealType: 'lunch',
          calories: 500,
          proteinG: 30,
          carbsG: 50,
          fatG: 15,
          loggedDate: oldDate,
        }),
      });

      // Exactly at window start (today - 13) -> included
      const edgeDate = shiftDateString(today, -13);
      await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Edge Window Oats',
          mealType: 'breakfast',
          calories: 380,
          proteinG: 28,
          carbsG: 48,
          fatG: 8,
          loggedDate: edgeDate,
        }),
      });

      // Duplicate case-insensitive meal across yesterday and today -> keeps latest values & logCount 2
      const yesterday = shiftDateString(today, -1);
      await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'chicken rice bowl',
          mealType: 'lunch',
          calories: 600,
          proteinG: 45,
          carbsG: 70,
          fatG: 15,
          loggedDate: yesterday,
        }),
      });
      await app.request('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          itemName: 'Chicken Rice Bowl',
          mealType: 'dinner',
          calories: 720,
          proteinG: 56,
          carbsG: 75,
          fatG: 18,
          loggedDate: today,
        }),
      });

      // Add 12 more distinct meals in window to test top-12 cap
      for (let i = 1; i <= 12; i++) {
        await app.request('/api/nutrition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersA },
          body: JSON.stringify({
            itemName: `Recent Dish ${i}`,
            mealType: 'snack',
            calories: 200 + i,
            proteinG: 20,
            carbsG: 20,
            fatG: 5,
            loggedDate: shiftDateString(today, -2),
          }),
        });
      }

      const res = await app.request(`/api/nutrition/saved?date=${today}`, {
        headers: headersA,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as SavedMealsListResponse;

      expect(body.recentMeals).toHaveLength(12);
      expect(body.recentMeals.some((m) => m.itemName === 'Ancient Meal')).toBe(false);
      expect(
        body.recentMeals.some((m) => /creatine/i.test(m.itemName)),
      ).toBe(false);

      const chicken = body.recentMeals.find(
        (m) => m.itemName.toLowerCase() === 'chicken rice bowl',
      );
      expect(chicken).toBeDefined();
      expect(chicken!.itemName).toBe('Chicken Rice Bowl');
      expect(chicken!.mealType).toBe('dinner');
      expect(chicken!.calories).toBe(720);
      expect(chicken!.proteinG).toBe(56);
      expect(chicken!.lastLoggedDate).toBe(today);
      expect(chicken!.logCount).toBe(2);
      // Most recent entry appears first
      expect(body.recentMeals[0].itemName).toBe('Chicken Rice Bowl');
    });
  });

  describe('Copy Yesterday (POST /api/nutrition/copy-yesterday)', () => {
    it('returns 200 with copiedCount 0 when source date has no meals, and 201 when meals are copied', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      const headersB = makeAuthHeaders(USER_B_ID);
      await onboardUser(app, headersA);
      await onboardUser(app, headersB);

      const yesterday = shiftDateString(today, -1);

      // Empty yesterday -> 200 & copiedCount: 0
      const emptyRes = await app.request('/api/nutrition/copy-yesterday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ targetDate: today }),
      });
      expect(emptyRes.status).toBe(200);
      const emptyBody = (await emptyRes.json()) as CopyYesterdayMealsResponse;
      expect(emptyBody).toEqual({
        copiedCount: 0,
        sourceDate: yesterday,
        targetDate: today,
        items: [],
      });

      // Seed yesterday meals + supplement for User A
      await app.request('/api/nutrition/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          source: 'AI_TEXT',
          items: [
            {
              itemName: 'Egg White Omelette',
              mealType: 'breakfast',
              calories: 320,
              proteinG: 32,
              carbsG: 12,
              fatG: 14,
              loggedDate: yesterday,
            },
            {
              itemName: 'Steak Salad',
              mealType: 'lunch',
              calories: 540,
              proteinG: 48,
              carbsG: 20,
              fatG: 28,
              loggedDate: yesterday,
            },
            {
              itemName: 'Protein Bar',
              mealType: 'snack',
              calories: 210,
              proteinG: 20,
              carbsG: 22,
              fatG: 7,
              loggedDate: yesterday,
            },
          ],
        }),
      });
      await app.request('/api/supplements/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ supplementKey: 'creatine', loggedDate: yesterday }),
      });

      // Filter mealTypes = ['breakfast', 'snack'] -> copies 2 items, skips lunch and supplement
      const filteredRes = await app.request('/api/nutrition/copy-yesterday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          targetDate: today,
          sourceDate: yesterday,
          mealTypes: ['breakfast', 'snack'],
        }),
      });
      expect(filteredRes.status).toBe(201);
      const filteredBody = (await filteredRes.json()) as CopyYesterdayMealsResponse;
      expect(filteredBody.copiedCount).toBe(2);
      expect(filteredBody.sourceDate).toBe(yesterday);
      expect(filteredBody.targetDate).toBe(today);
      expect(filteredBody.items.map((i) => i.itemName)).toEqual([
        'Egg White Omelette',
        'Protein Bar',
      ]);
      expect(filteredBody.items.every((i) => i.source === 'MANUAL')).toBe(true);
      expect(filteredBody.items.every((i) => i.loggedDate === today)).toBe(true);

      // Empty body copies all non-supplement meals from Bangkok yesterday to Bangkok today
      const userBCopy = await app.request('/api/nutrition/copy-yesterday', {
        method: 'POST',
        headers: headersB,
      });
      expect(userBCopy.status).toBe(200);
      const userBCopyBody = (await userBCopy.json()) as CopyYesterdayMealsResponse;
      expect(userBCopyBody.copiedCount).toBe(0);
    });
  });

  describe('Hydration Endpoints, Dashboard & Calendar Integration', () => {
    it('tracks water logs, computes creatine/workout bonuses, enforces ownership, and feeds dashboard & calendar', async () => {
      const { app, today } = createTestContext();
      const headersA = makeAuthHeaders(USER_A_ID);
      const headersB = makeAuthHeaders(USER_B_ID);
      await onboardUser(app, headersA, { weight_kg: 80 });
      await onboardUser(app, headersB, { weight_kg: 60 });

      // Unauthenticated -> 401
      const unauthGet = await app.request('/api/hydration/today');
      expect(unauthGet.status).toBe(401);

      // Invalid date -> 400
      const badDate = await app.request('/api/hydration/today?date=28-11-2026', {
        headers: headersA,
      });
      expect(badDate.status).toBe(400);

      // 80kg -> base = 2800ml, default supplement stack has creatine (+500ml), 0 active kcal -> 3300ml
      const initRes = await app.request(`/api/hydration/today?date=${today}`, {
        headers: headersA,
      });
      expect(initRes.status).toBe(200);
      const initSummary = (await initRes.json()) as WaterLogSummaryDTO;
      expect(initSummary).toEqual({
        date: today,
        consumedMl: 0,
        targetMl: 3300,
        remainingMl: 3300,
        percentage: 0,
        breakdown: {
          baseMl: 2800,
          workoutBonusMl: 0,
          creatineBonusMl: 500,
        },
        entries: [],
      });

      // Add a workout (400 kcal -> +200ml bonus -> target 3500ml)
      await app.request('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          activityName: 'Tempo Run',
          category: 'cardio',
          durationMin: 40,
          activeCalories: 400,
          intensity: 'high',
          loggedDate: today,
        }),
      });

      // Log 500ml and 750ml
      const post1 = await app.request('/api/hydration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ amountMl: 500, loggedDate: today }),
      });
      expect(post1.status).toBe(201);
      const post2 = await app.request('/api/hydration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ amountMl: 750, loggedDate: today }),
      });
      expect(post2.status).toBe(201);
      const afterPost2 = (await post2.json()) as WaterLogSummaryDTO;
      expect(afterPost2.consumedMl).toBe(1250);
      expect(afterPost2.targetMl).toBe(3500);
      expect(afterPost2.remainingMl).toBe(2250);
      expect(afterPost2.percentage).toBe(36);
      expect(afterPost2.breakdown).toEqual({
        baseMl: 2800,
        workoutBonusMl: 200,
        creatineBonusMl: 500,
      });
      expect(afterPost2.entries).toHaveLength(2);

      // Invalid water amount (< 50 or > 5000) -> 400
      const invalidAmount = await app.request('/api/hydration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({ amountMl: 25, loggedDate: today }),
      });
      expect(invalidAmount.status).toBe(400);

      // Dashboard & Bootstrap include hydration
      const dashRes = await app.request(`/api/dashboard/today?date=${today}`, {
        headers: headersA,
      });
      expect(dashRes.status).toBe(200);
      const dash = (await dashRes.json()) as DashboardTodayResponse;
      expect(dash.hydration).toEqual(afterPost2);

      const bootstrapRes = await app.request(`/api/dashboard/bootstrap?date=${today}`, {
        headers: headersA,
      });
      expect(bootstrapRes.status).toBe(200);
      const bootstrap = (await bootstrapRes.json()) as DashboardBootstrapResponse;
      expect(bootstrap.dashboard?.hydration).toEqual(afterPost2);

      // Monthly calendar includes waterMl for today (and User B has 0)
      const month = today.slice(0, 7);
      const calARes = await app.request(`/api/dashboard/calendar?month=${month}`, {
        headers: headersA,
      });
      expect(calARes.status).toBe(200);
      const calA = (await calARes.json()) as MonthlyCalendarResponse;
      const todayCalA = calA.days.find((d) => d.date === today);
      expect(todayCalA?.waterMl).toBe(1250);

      const calBRes = await app.request(`/api/dashboard/calendar?month=${month}`, {
        headers: headersB,
      });
      const calB = (await calBRes.json()) as MonthlyCalendarResponse;
      const todayCalB = calB.days.find((d) => d.date === today);
      expect(todayCalB?.waterMl).toBe(0);

      // User B cannot delete User A's water entry -> 404
      const entryId = afterPost2.entries[0].id;
      const crossDel = await app.request(`/api/hydration/${entryId}`, {
        method: 'DELETE',
        headers: headersB,
      });
      expect(crossDel.status).toBe(404);

      // User A removes creatine from supplement stack -> target drops by 500ml (to 3000ml)
      const suppRes = await app.request('/api/settings/supplements', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headersA },
        body: JSON.stringify({
          supplements: [
            { key: 'omega3', name: 'Omega-3', dosage: '2g', timing: 'Lunch' },
          ],
        }),
      });
      expect(suppRes.status).toBe(200);

      // Delete first 500ml water entry -> consumed becomes 750ml, target becomes 3000ml
      const delOwner = await app.request(`/api/hydration/${entryId}`, {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delOwner.status).toBe(200);
      const afterDel = (await delOwner.json()) as WaterLogSummaryDTO;
      expect(afterDel.consumedMl).toBe(750);
      expect(afterDel.targetMl).toBe(3000);
      expect(afterDel.breakdown.creatineBonusMl).toBe(0);
      expect(afterDel.entries).toHaveLength(1);

      // Deleting nonexistent hydration ID -> 404
      const delMissing = await app.request('/api/hydration/missing-id', {
        method: 'DELETE',
        headers: headersA,
      });
      expect(delMissing.status).toBe(404);
    });

    it('exposes seeded saved meals and hydration on SEED_USER_ID', async () => {
      const { app, today } = createTestContext();
      const seedHeaders = makeAuthHeaders(SEED_USER_ID);

      const savedRes = await app.request(`/api/nutrition/saved?date=${today}`, {
        headers: seedHeaders,
      });
      expect(savedRes.status).toBe(200);
      const savedBody = (await savedRes.json()) as SavedMealsListResponse;
      expect(savedBody.savedMeals.length).toBeGreaterThanOrEqual(3);
      expect(savedBody.savedMeals[0].usageCount).toBeGreaterThanOrEqual(
        savedBody.savedMeals[1].usageCount,
      );

      // Log with empty JSON body -> uses default multiplier 1 and defaultMealType
      const logDefaultRes = await app.request(
        `/api/nutrition/saved/${savedBody.savedMeals[0].id}/log`,
        {
          method: 'POST',
          headers: seedHeaders,
        },
      );
      expect(logDefaultRes.status).toBe(201);
      const logDefault = (await logDefaultRes.json()) as LogSavedMealResponse;
      expect(logDefault.meal.calories).toBe(savedBody.savedMeals[0].calories);

      const dashRes = await app.request(`/api/dashboard/today?date=${today}`, {
        headers: seedHeaders,
      });
      expect(dashRes.status).toBe(200);
      const dash = (await dashRes.json()) as DashboardTodayResponse;
      expect(dash.hydration).toBeDefined();
      expect(dash.hydration!.consumedMl).toBe(1250);
      expect(dash.hydration!.entries).toHaveLength(2);
    });
  });
});
