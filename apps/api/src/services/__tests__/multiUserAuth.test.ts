import { describe, expect, it } from 'bun:test';
import {
  WebhookKeyResponseSchema,
  type AppleHealthWebhookResponse,
  type DashboardTodayResponse,
  type MeResponseDTO,
  type MetricsTrendsResponse,
  type NutritionLogDTO,
  type SyncStatusDTO,
  type WebhookKeyResponse,
  type WorkoutLogDTO,
} from '@health-dash/shared';
import type { Hono } from 'hono';
import { createApp } from '../../app';
import { getBangkokDateString, InMemoryHealthRepository } from '../../db/repository';
import { signHs256Jwt, verifyHs256Jwt } from '../../middleware/auth';

const TEST_JWT_SECRET = 'test-multi-user-auth-jwt-secret-0123456789abcdef';
const USER_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createTestContext() {
  const today = getBangkokDateString();
  const repo = new InMemoryHealthRepository(today);
  const app = createApp(repo, { jwtSecret: TEST_JWT_SECRET });
  return { app, repo, today };
}

function makeAuthHeaders(
  userId: string,
  options?: { email?: string; name?: string; exp?: number; secret?: string },
): Record<string, string> {
  const token = signHs256Jwt(
    {
      sub: userId,
      ...(options?.email ? { email: options.email } : {}),
      ...(options?.name ? { name: options.name } : {}),
      ...(options?.exp !== undefined ? { exp: options.exp } : {}),
    },
    options?.secret ?? TEST_JWT_SECRET,
  );
  return { Authorization: `Bearer ${token}` };
}

async function onboardUser(
  app: Hono,
  headers: Record<string, string>,
  payload: {
    name: string;
    gender: 'male' | 'female' | 'other';
    birth_date: string;
    height_cm: number;
    weight_kg: number;
    goal_type: 'CUT' | 'MAINTAIN' | 'BULK';
    calorie_adjustment: number;
  },
): Promise<MeResponseDTO> {
  const res = await app.request('/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as MeResponseDTO;
}

describe('Multi-User Auth, Strict Isolation & Per-User Webhook Verification', () => {
  it('Case 1: returns 401 on all protected endpoints without valid JWT while keeping GET /api/health public', async () => {
    const { app } = createTestContext();

    // Public health check remains open without Authorization
    const healthRes = await app.request('/api/health');
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as {
      status: string;
      storageMode: string;
    };
    expect(healthBody.status).toBe('ok');
    expect(healthBody.storageMode).toBe('memory');

    const protectedRequests: Array<{
      label: string;
      path: string;
      method: 'GET' | 'POST' | 'DELETE';
      body?: string;
      contentType?: string;
    }> = [
      { label: 'GET /api/me', path: '/api/me', method: 'GET' },
      {
        label: 'POST /api/onboarding',
        path: '/api/onboarding',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({}),
      },
      {
        label: 'POST /api/settings/webhook-key',
        path: '/api/settings/webhook-key',
        method: 'POST',
      },
      {
        label: 'GET /api/dashboard/today',
        path: '/api/dashboard/today',
        method: 'GET',
      },
      {
        label: 'GET /api/metrics/trends',
        path: '/api/metrics/trends',
        method: 'GET',
      },
      {
        label: 'POST /api/nutrition',
        path: '/api/nutrition',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({}),
      },
      {
        label: 'POST /api/nutrition/batch',
        path: '/api/nutrition/batch',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      },
      {
        label: 'POST /api/workouts',
        path: '/api/workouts',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({}),
      },
      {
        label: 'POST /api/metrics',
        path: '/api/metrics',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({}),
      },
      {
        label: 'GET /api/webhooks/status',
        path: '/api/webhooks/status',
        method: 'GET',
      },
    ];

    const invalidSecretHeaders = makeAuthHeaders(USER_A_ID, {
      secret: 'wrong-jwt-secret-0123456789',
    });
    const expiredHeaders = makeAuthHeaders(USER_A_ID, {
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    // Verify verifyHs256Jwt directly rejects expired and wrong-secret tokens
    expect(
      verifyHs256Jwt(
        expiredHeaders.Authorization.replace('Bearer ', ''),
        TEST_JWT_SECRET,
      ),
    ).toBeNull();
    expect(
      verifyHs256Jwt(
        invalidSecretHeaders.Authorization.replace('Bearer ', ''),
        TEST_JWT_SECRET,
      ),
    ).toBeNull();

    const authVariants: Array<{ name: string; headers?: Record<string, string> }> = [
      { name: 'missing Authorization header' },
      { name: 'malformed Authorization header', headers: { Authorization: 'Basic abc' } },
      { name: 'wrong-secret JWT', headers: invalidSecretHeaders },
      { name: 'expired JWT', headers: expiredHeaders },
    ];

    for (const endpoint of protectedRequests) {
      for (const variant of authVariants) {
        const headers: Record<string, string> = {
          ...(variant.headers ?? {}),
          ...(endpoint.contentType ? { 'Content-Type': endpoint.contentType } : {}),
        };
        const res = await app.request(endpoint.path, {
          method: endpoint.method,
          headers,
          ...(endpoint.body !== undefined ? { body: endpoint.body } : {}),
        });
        expect(res.status).toBe(401);
      }
    }
  });

  it('Case 2: handles onboarding and enforces strict multi-user isolation between User A and User B', async () => {
    const { app, today } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID, { email: 'usera@example.com' });
    const userBHeaders = makeAuthHeaders(USER_B_ID, { email: 'userb@example.com' });

    // Before onboarding: both users get onboarded: false and 404 on dashboard
    for (const [expectedId, headers] of [
      [USER_A_ID, userAHeaders],
      [USER_B_ID, userBHeaders],
    ] as const) {
      const meRes = await app.request('/api/me', { headers });
      expect(meRes.status).toBe(200);
      const me = (await meRes.json()) as MeResponseDTO;
      expect(me.userId).toBe(expectedId);
      expect(me.onboarded).toBe(false);
      expect(me.profile).toBeNull();
      expect(me.goal).toBeNull();
      expect(me.webhookKey.configured).toBe(false);

      const preDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
        headers,
      });
      expect(preDashRes.status).toBe(404);
    }

    // User A onboarding: male, 72 kg, CUT -350
    const userAMe = await onboardUser(app, userAHeaders, {
      name: 'User A',
      gender: 'male',
      birth_date: '1994-05-10',
      height_cm: 178,
      weight_kg: 72,
      goal_type: 'CUT',
      calorie_adjustment: -350,
    });
    expect(userAMe.onboarded).toBe(true);
    expect(userAMe.profile?.id).toBe(USER_A_ID);
    expect(userAMe.profile?.sex).toBe('male');
    expect(userAMe.goal?.goalType).toBe('CUT');
    expect(userAMe.goal?.calorieAdjustment).toBe(-350);

    // User A logs a meal and workout
    const userAMealRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        itemName: 'User A Chicken',
        mealType: 'lunch',
        calories: 520,
        proteinG: 48,
        carbsG: 40,
        fatG: 16,
        loggedDate: today,
      }),
    });
    expect(userAMealRes.status).toBe(201);
    const userAMeal = (await userAMealRes.json()) as NutritionLogDTO;
    expect(userAMeal.userId).toBe(USER_A_ID);

    const userAWorkoutRes = await app.request('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        activityName: 'User A Run',
        category: 'cardio',
        durationMin: 35,
        activeCalories: 340,
        intensity: 'moderate',
        loggedDate: today,
      }),
    });
    expect(userAWorkoutRes.status).toBe(201);
    const userAWorkout = (await userAWorkoutRes.json()) as WorkoutLogDTO;
    expect(userAWorkout.userId).toBe(USER_A_ID);

    // User B onboarding: female, 58 kg, BULK +300
    const userBMe = await onboardUser(app, userBHeaders, {
      name: 'User B',
      gender: 'female',
      birth_date: '1997-08-22',
      height_cm: 164,
      weight_kg: 58,
      goal_type: 'BULK',
      calorie_adjustment: 300,
    });
    expect(userBMe.onboarded).toBe(true);
    expect(userBMe.profile?.id).toBe(USER_B_ID);
    expect(userBMe.profile?.sex).toBe('female');
    expect(userBMe.goal?.goalType).toBe('BULK');
    expect(userBMe.goal?.calorieAdjustment).toBe(300);

    // User B logs a different meal and workout
    const userBMealRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userBHeaders },
      body: JSON.stringify({
        itemName: 'User B Oats',
        mealType: 'breakfast',
        calories: 380,
        proteinG: 18,
        carbsG: 56,
        fatG: 9,
        loggedDate: today,
      }),
    });
    expect(userBMealRes.status).toBe(201);
    const userBMeal = (await userBMealRes.json()) as NutritionLogDTO;
    expect(userBMeal.userId).toBe(USER_B_ID);

    const userBWorkoutRes = await app.request('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userBHeaders },
      body: JSON.stringify({
        activityName: 'User B Mobility',
        category: 'mobility',
        durationMin: 25,
        activeCalories: 110,
        intensity: 'low',
        loggedDate: today,
      }),
    });
    expect(userBWorkoutRes.status).toBe(201);
    const userBWorkout = (await userBWorkoutRes.json()) as WorkoutLogDTO;
    expect(userBWorkout.userId).toBe(USER_B_ID);

    // Assert User A dashboard & trends contain ONLY User A's data
    const userADashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    expect(userADashRes.status).toBe(200);
    const userADash = (await userADashRes.json()) as DashboardTodayResponse;
    expect(userADash.profile.id).toBe(USER_A_ID);
    expect(userADash.latestMetric.weightKg).toBe(72);
    expect(userADash.meals.map((m) => m.itemName)).toEqual(['User A Chicken']);
    expect(userADash.workouts.map((w) => w.activityName)).toEqual(['User A Run']);
    expect(userADash.energy.consumedCalories).toBe(520);
    expect(userADash.energy.activeCalories).toBe(340);

    const userATrendsRes = await app.request('/api/metrics/trends?days=30', {
      headers: userAHeaders,
    });
    expect(userATrendsRes.status).toBe(200);
    const userATrends = (await userATrendsRes.json()) as MetricsTrendsResponse;
    expect(userATrends.points).toHaveLength(1);
    expect(userATrends.points[0].weightKg).toBe(72);
    expect(userATrends.summary.currentWeightKg).toBe(72);

    // Assert User B dashboard & trends contain ONLY User B's data
    const userBDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userBHeaders,
    });
    expect(userBDashRes.status).toBe(200);
    const userBDash = (await userBDashRes.json()) as DashboardTodayResponse;
    expect(userBDash.profile.id).toBe(USER_B_ID);
    expect(userBDash.latestMetric.weightKg).toBe(58);
    expect(userBDash.meals.map((m) => m.itemName)).toEqual(['User B Oats']);
    expect(userBDash.workouts.map((w) => w.activityName)).toEqual(['User B Mobility']);
    expect(userBDash.energy.consumedCalories).toBe(380);
    expect(userBDash.energy.activeCalories).toBe(110);

    const userBTrendsRes = await app.request('/api/metrics/trends?days=30', {
      headers: userBHeaders,
    });
    expect(userBTrendsRes.status).toBe(200);
    const userBTrends = (await userBTrendsRes.json()) as MetricsTrendsResponse;
    expect(userBTrends.points).toHaveLength(1);
    expect(userBTrends.points[0].weightKg).toBe(58);
    expect(userBTrends.summary.currentWeightKg).toBe(58);

    // Cross-user deletion attempts return 404 and leave victim rows intact
    const crossDeleteMealRes = await app.request(`/api/nutrition/${userBMeal.id}`, {
      method: 'DELETE',
      headers: userAHeaders,
    });
    expect(crossDeleteMealRes.status).toBe(404);

    const crossDeleteWorkoutRes = await app.request(`/api/workouts/${userBWorkout.id}`, {
      method: 'DELETE',
      headers: userAHeaders,
    });
    expect(crossDeleteWorkoutRes.status).toBe(404);

    const userBAfterCrossAttempt = await app.request(
      `/api/dashboard/today?date=${today}`,
      { headers: userBHeaders },
    );
    expect(userBAfterCrossAttempt.status).toBe(200);
    const userBAfterData =
      (await userBAfterCrossAttempt.json()) as DashboardTodayResponse;
    expect(userBAfterData.meals.some((m) => m.id === userBMeal.id)).toBe(true);
    expect(userBAfterData.workouts.some((w) => w.id === userBWorkout.id)).toBe(true);
  });

  it('Case 3: isolates per-user Apple Health webhook keys, sync state, and key regeneration', async () => {
    const { app, today } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID, { email: 'usera@example.com' });
    const userBHeaders = makeAuthHeaders(USER_B_ID, { email: 'userb@example.com' });

    await onboardUser(app, userAHeaders, {
      name: 'User A',
      gender: 'male',
      birth_date: '1994-05-10',
      height_cm: 178,
      weight_kg: 72,
      goal_type: 'CUT',
      calorie_adjustment: -350,
    });
    await onboardUser(app, userBHeaders, {
      name: 'User B',
      gender: 'female',
      birth_date: '1997-08-22',
      height_cm: 164,
      weight_kg: 58,
      goal_type: 'BULK',
      calorie_adjustment: 300,
    });

    const userBBeforeDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userBHeaders,
    });
    expect(userBBeforeDashRes.status).toBe(200);
    const userBBeforeDash = (await userBBeforeDashRes.json()) as DashboardTodayResponse;
    const userBInitialTdee = userBBeforeDash.energy.dynamicTdee;
    expect(userBBeforeDash.latestMetric.weightKg).toBe(58);

    // User A generates personal webhook key
    const genRes = await app.request('/api/settings/webhook-key', {
      method: 'POST',
      headers: userAHeaders,
    });
    expect(genRes.status).toBe(201);
    const key1 = (await genRes.json()) as WebhookKeyResponse;
    expect(WebhookKeyResponseSchema.safeParse(key1).success).toBe(true);
    expect(key1.api_key.startsWith('hk_live_')).toBe(true);
    expect(key1.masked_key.startsWith(key1.api_key.slice(0, 12))).toBe(true);

    // GET /api/me confirms webhookKey.configured === true without leaking raw api_key
    const userAMeRes = await app.request('/api/me', { headers: userAHeaders });
    expect(userAMeRes.status).toBe(200);
    const userAMeText = await userAMeRes.text();
    expect(userAMeText).not.toContain(key1.api_key);
    const userAMe = JSON.parse(userAMeText) as MeResponseDTO;
    expect(userAMe.webhookKey.configured).toBe(true);
    expect(userAMe.webhookKey.masked_key).toBe(key1.masked_key);

    // User B still has no webhook key configured
    const userBMeRes = await app.request('/api/me', { headers: userBHeaders });
    expect(userBMeRes.status).toBe(200);
    const userBMe = (await userBMeRes.json()) as MeResponseDTO;
    expect(userBMe.webhookKey.configured).toBe(false);

    // Sync Apple Health with User A's X-API-Key
    const syncRes = await app.request('/api/webhooks/apple-health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key1.api_key,
      },
      body: JSON.stringify({
        weight_kg: 71.0,
        active_calories: 410,
      }),
    });
    expect(syncRes.status).toBe(200);
    const syncBody = (await syncRes.json()) as AppleHealthWebhookResponse;
    expect(syncBody.ok).toBe(true);
    expect(syncBody.recorded_date).toBe(today);
    expect(syncBody.updated_fields).toEqual(['weight_kg', 'active_calories']);

    // Verify User A's body_metrics, workout_logs, and webhook status updated
    const userADashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    expect(userADashRes.status).toBe(200);
    const userADash = (await userADashRes.json()) as DashboardTodayResponse;
    expect(userADash.latestMetric.weightKg).toBe(71.0);
    expect(userADash.energy.activeCalories).toBe(410);
    const userAAppleWorkout = userADash.workouts.find(
      (w) => w.activityType === 'APPLE_HEALTH_SYNC',
    );
    expect(userAAppleWorkout?.activeCalories).toBe(410);

    const userAStatusRes = await app.request('/api/webhooks/status', {
      headers: userAHeaders,
    });
    expect(userAStatusRes.status).toBe(200);
    const userAStatus = (await userAStatusRes.json()) as SyncStatusDTO;
    expect(userAStatus.status).toBe('SUCCESS');
    expect(userAStatus.synced_fields).toEqual(['weight_kg', 'active_calories']);

    // Verify User B's weight, Dynamic TDEE, workouts, and sync status ('NEVER') remain completely untouched
    const userBAfterDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userBHeaders,
    });
    expect(userBAfterDashRes.status).toBe(200);
    const userBAfterDash = (await userBAfterDashRes.json()) as DashboardTodayResponse;
    expect(userBAfterDash.latestMetric.weightKg).toBe(58);
    expect(userBAfterDash.energy.dynamicTdee).toBe(userBInitialTdee);
    expect(userBAfterDash.energy.activeCalories).toBe(0);
    expect(userBAfterDash.workouts).toHaveLength(0);

    const userBStatusRes = await app.request('/api/webhooks/status', {
      headers: userBHeaders,
    });
    expect(userBStatusRes.status).toBe(200);
    const userBStatus = (await userBStatusRes.json()) as SyncStatusDTO;
    expect(userBStatus).toEqual({
      status: 'NEVER',
      last_synced_at: null,
      synced_fields: [],
    });

    // Regenerate User A's webhook key -> old key immediately returns 401, new key succeeds (200)
    const regenRes = await app.request('/api/settings/webhook-key', {
      method: 'POST',
      headers: userAHeaders,
    });
    expect(regenRes.status).toBe(201);
    const key2 = (await regenRes.json()) as WebhookKeyResponse;
    expect(key2.api_key.startsWith('hk_live_')).toBe(true);
    expect(key2.api_key).not.toBe(key1.api_key);

    const oldKeyRes = await app.request('/api/webhooks/apple-health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key1.api_key,
      },
      body: JSON.stringify({
        weight_kg: 70.5,
        active_calories: 450,
      }),
    });
    expect(oldKeyRes.status).toBe(401);

    const newKeyRes = await app.request('/api/webhooks/apple-health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key2.api_key,
      },
      body: JSON.stringify({
        weight_kg: 70.5,
        active_calories: 450,
      }),
    });
    expect(newKeyRes.status).toBe(200);

    const userAFinalDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    expect(userAFinalDashRes.status).toBe(200);
    const userAFinalDash = (await userAFinalDashRes.json()) as DashboardTodayResponse;
    expect(userAFinalDash.latestMetric.weightKg).toBe(70.5);
    expect(userAFinalDash.energy.activeCalories).toBe(450);
  });
});
