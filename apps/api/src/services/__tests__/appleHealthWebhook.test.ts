import { describe, expect, it } from 'bun:test';
import {
  AppleHealthWebhookPayloadSchema,
  SyncStatusSchema,
  WebhookKeyResponseSchema,
  type AppleHealthWebhookResponse,
  type DashboardTodayResponse,
  type SyncStatusDTO,
  type WebhookKeyResponse,
} from '@health-dash/shared';
import type { Hono } from 'hono';
import { createApp } from '../../app';
import {
  getBangkokDateString,
  InMemoryHealthRepository,
  SEED_USER_ID,
} from '../../db/repository';
import { signHs256Jwt } from '../../middleware/auth';

const TEST_JWT_SECRET = 'test-jwt-secret-apple-health-webhook-0123456789';

async function createWebhookTestApp(options?: { generateKey?: boolean }) {
  const today = getBangkokDateString();
  const repo = new InMemoryHealthRepository(today);
  const app = createApp(repo, { jwtSecret: TEST_JWT_SECRET });
  const token = signHs256Jwt({ sub: SEED_USER_ID }, TEST_JWT_SECRET);
  const authHeaders = { Authorization: `Bearer ${token}` };

  let apiKey = '';
  if (options?.generateKey !== false) {
    const keyRes = await app.request('/api/settings/webhook-key', {
      method: 'POST',
      headers: authHeaders,
    });
    expect(keyRes.status).toBe(201);
    const keyData = (await keyRes.json()) as WebhookKeyResponse;
    expect(WebhookKeyResponseSchema.safeParse(keyData).success).toBe(true);
    expect(keyData.api_key.startsWith('hk_live_')).toBe(true);
    apiKey = keyData.api_key;
  }

  return { app, repo, today, authHeaders, apiKey };
}

async function postWebhook(
  app: Hono,
  payload: unknown,
  apiKey: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey !== null) {
    headers['X-API-Key'] = apiKey;
  }

  return app.request('/api/webhooks/apple-health', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

async function getTodayDashboard(
  app: Hono,
  date: string,
  authHeaders: Record<string, string>,
): Promise<DashboardTodayResponse> {
  const res = await app.request(`/api/dashboard/today?date=${date}`, {
    headers: authHeaders,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardTodayResponse;
}

async function getWebhookStatus(
  app: Hono,
  authHeaders: Record<string, string>,
): Promise<SyncStatusDTO> {
  const res = await app.request('/api/webhooks/status', {
    headers: authHeaders,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as SyncStatusDTO;
  expect(SyncStatusSchema.safeParse(body).success).toBe(true);
  return body;
}

describe('AppleHealthWebhookPayloadSchema Preprocessing & Normalization', () => {
  it('treats empty strings, whitespace, "null", "undefined", and null as undefined', () => {
    const parsed = AppleHealthWebhookPayloadSchema.parse({
      recorded_date: '',
      weight_kg: '   ',
      body_fat_pct: '',
      skeletal_muscle_kg: null,
      resting_hr: 'null',
      sleep_hours: 'undefined',
      active_calories: undefined,
    });

    expect(parsed).toEqual({
      recorded_date: undefined,
      weight_kg: undefined,
      body_fat_pct: undefined,
      skeletal_muscle_kg: undefined,
      resting_hr: undefined,
      sleep_hours: undefined,
      active_calories: undefined,
    });
  });

  it('coerces numeric strings and normalizes 0..1 body fat ratios to percentages', () => {
    const parsedRatio = AppleHealthWebhookPayloadSchema.parse({
      weight_kg: '74.2',
      body_fat_pct: 0.23,
      resting_hr: '52',
      sleep_hours: '7.5',
      active_calories: '410',
    });
    expect(parsedRatio.weight_kg).toBe(74.2);
    expect(parsedRatio.body_fat_pct).toBe(23);
    expect(parsedRatio.resting_hr).toBe(52);
    expect(parsedRatio.sleep_hours).toBe(7.5);
    expect(parsedRatio.active_calories).toBe(410);

    expect(
      AppleHealthWebhookPayloadSchema.parse({ body_fat_pct: '0.165' }).body_fat_pct,
    ).toBe(16.5);
    expect(
      AppleHealthWebhookPayloadSchema.parse({ body_fat_pct: 17.4 }).body_fat_pct,
    ).toBe(17.4);
    expect(
      AppleHealthWebhookPayloadSchema.parse({ body_fat_pct: 0 }).body_fat_pct,
    ).toBe(0);
  });

  it('rejects malformed dates and out-of-range measurements', () => {
    expect(
      AppleHealthWebhookPayloadSchema.safeParse({ recorded_date: '25-11-2026' })
        .success,
    ).toBe(false);
    expect(
      AppleHealthWebhookPayloadSchema.safeParse({ weight_kg: 10 }).success,
    ).toBe(false);
    expect(
      AppleHealthWebhookPayloadSchema.safeParse({ body_fat_pct: 80 }).success,
    ).toBe(false);
    expect(
      AppleHealthWebhookPayloadSchema.safeParse({ sleep_hours: 25 }).success,
    ).toBe(false);
  });
});

describe('Apple Health Webhook API & Safe Upsert Tests (app.request)', () => {
  it('Case 1: enforces per-user X-API-Key authentication (401 on missing, empty, unconfigured, different-length, and same-length keys)', async () => {
    const { app: unconfiguredApp, today } = await createWebhookTestApp({
      generateKey: false,
    });
    const unconfiguredRes = await postWebhook(
      unconfiguredApp,
      { recorded_date: today, resting_hr: 54 },
      'hk_live_unconfigured_key_0123456789abcdef0123456789abcdef',
    );
    expect(unconfiguredRes.status).toBe(401);

    const { app, apiKey } = await createWebhookTestApp();

    // Missing X-API-Key header
    const missingRes = await postWebhook(
      app,
      { recorded_date: today, resting_hr: 54 },
      null,
    );
    expect(missingRes.status).toBe(401);

    // Empty X-API-Key header
    const emptyHeaderRes = await postWebhook(
      app,
      { recorded_date: today, resting_hr: 54 },
      '',
    );
    expect(emptyHeaderRes.status).toBe(401);

    // Wrong X-API-Key with different length
    const diffLengthRes = await postWebhook(
      app,
      { recorded_date: today, resting_hr: 54 },
      'wrong-short-key',
    );
    expect(diffLengthRes.status).toBe(401);

    // Wrong X-API-Key with exact same length as generated personal key
    const lastChar = apiKey.endsWith('a') ? 'b' : 'a';
    const sameLengthWrongKey = `${apiKey.slice(0, -1)}${lastChar}`;
    expect(sameLengthWrongKey.length).toBe(apiKey.length);
    const sameLengthRes = await postWebhook(
      app,
      { recorded_date: today, resting_hr: 54 },
      sameLengthWrongKey,
    );
    expect(sameLengthRes.status).toBe(401);

    // Valid personal hk_live_... X-API-Key succeeds
    const validRes = await postWebhook(
      app,
      { recorded_date: today, resting_hr: 54 },
      apiKey,
    );
    expect(validRes.status).toBe(200);
  });

  it('Case 2: performs partial safe upsert without overwriting existing weight/body_fat/muscle on "" or null', async () => {
    const { app, today, authHeaders, apiKey } = await createWebhookTestApp();

    const initial = await getTodayDashboard(app, today, authHeaders);
    expect(initial.latestMetric.weightKg).toBe(74.9);
    expect(initial.latestMetric.bodyFatPct).toBe(16.5);
    expect(initial.latestMetric.skeletalMuscleMassKg).toBe(35.6);

    const res = await postWebhook(
      app,
      {
        recorded_date: today,
        weight_kg: '',
        body_fat_pct: '',
        skeletal_muscle_kg: null,
        resting_hr: 53,
        sleep_hours: 7.6,
      },
      apiKey,
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as AppleHealthWebhookResponse;
    expect(body.ok).toBe(true);
    expect(body.recorded_date).toBe(today);
    expect(body.updated_fields).toEqual(['resting_hr', 'sleep_hours']);
    expect(body.updated_fields).not.toContain('weight_kg');
    expect(body.updated_fields).not.toContain('body_fat_pct');
    expect(body.updated_fields).not.toContain('skeletal_muscle_kg');

    const after = await getTodayDashboard(app, today, authHeaders);
    expect(after.latestMetric.weightKg).toBe(74.9);
    expect(after.latestMetric.bodyFatPct).toBe(16.5);
    expect(after.latestMetric.skeletalMuscleMassKg).toBe(35.6);
    expect(after.latestMetric.restingHr).toBe(53);
    expect(after.latestMetric.sleepHours).toBe(7.6);

    // Partial sync onto a new date without weight_kg falls back to latest known weight
    const futureRes = await postWebhook(
      app,
      {
        recorded_date: '2099-01-01',
        resting_hr: 50,
      },
      apiKey,
    );
    expect(futureRes.status).toBe(200);
    const futureDash = await getTodayDashboard(app, '2099-01-01', authHeaders);
    expect(futureDash.latestMetric.recordedDate).toBe('2099-01-01');
    expect(futureDash.latestMetric.weightKg).toBe(74.9);
    expect(futureDash.latestMetric.restingHr).toBe(50);
  });

  it('Case 3: normalizes 0..1 body_fat_pct ratios to percentages while keeping percentage values unchanged', async () => {
    const { app, today, authHeaders, apiKey } = await createWebhookTestApp();

    const ratioRes = await postWebhook(
      app,
      {
        recorded_date: today,
        body_fat_pct: 0.23,
      },
      apiKey,
    );
    expect(ratioRes.status).toBe(200);
    const ratioBody = (await ratioRes.json()) as AppleHealthWebhookResponse;
    expect(ratioBody.updated_fields).toEqual(['body_fat_pct']);

    const afterRatio = await getTodayDashboard(app, today, authHeaders);
    expect(afterRatio.latestMetric.bodyFatPct).toBe(23);

    const pctRes = await postWebhook(
      app,
      {
        recorded_date: today,
        body_fat_pct: 17.4,
      },
      apiKey,
    );
    expect(pctRes.status).toBe(200);

    const afterPct = await getTodayDashboard(app, today, authHeaders);
    expect(afterPct.latestMetric.bodyFatPct).toBe(17.4);

    const stringRatioRes = await postWebhook(
      app,
      {
        recorded_date: today,
        body_fat_pct: '0.165',
      },
      apiKey,
    );
    expect(stringRatioRes.status).toBe(200);

    const afterStringRatio = await getTodayDashboard(app, today, authHeaders);
    expect(afterStringRatio.latestMetric.bodyFatPct).toBe(16.5);
  });

  it('Case 4: updates APPLE_HEALTH_SYNC active_calories idempotently on the same day without doubling', async () => {
    const { app, today, authHeaders, apiKey } = await createWebhookTestApp();

    const initial = await getTodayDashboard(app, today, authHeaders);
    const initialDynamicTdee = initial.energy.dynamicTdee;
    const initialActiveCalories = initial.energy.activeCalories;
    const initialManualCount = initial.workouts.filter(
      (w) => w.activityType !== 'APPLE_HEALTH_SYNC',
    ).length;

    // First Apple Health active calories sync (300 kcal)
    const firstRes = await postWebhook(
      app,
      {
        recorded_date: today,
        active_calories: 300,
      },
      apiKey,
    );
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as AppleHealthWebhookResponse;
    expect(firstBody.updated_fields).toEqual(['active_calories']);
    expect(firstBody.dynamic_tdee).toBe(initialDynamicTdee + 300);

    const afterFirst = await getTodayDashboard(app, today, authHeaders);
    const firstAppleWorkouts = afterFirst.workouts.filter(
      (w) => w.activityType === 'APPLE_HEALTH_SYNC',
    );
    expect(firstAppleWorkouts).toHaveLength(1);
    expect(firstAppleWorkouts[0].activeCalories).toBe(300);
    expect(afterFirst.energy.activeCalories).toBe(initialActiveCalories + 300);
    expect(afterFirst.energy.dynamicTdee).toBe(initialDynamicTdee + 300);

    // Second Apple Health active calories sync on the SAME day (520 kcal -> replaces 300, never 820)
    const secondRes = await postWebhook(
      app,
      {
        recorded_date: today,
        active_calories: 520,
      },
      apiKey,
    );
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as AppleHealthWebhookResponse;
    expect(secondBody.updated_fields).toEqual(['active_calories']);
    expect(secondBody.dynamic_tdee).toBe(initialDynamicTdee + 520);

    const afterSecond = await getTodayDashboard(app, today, authHeaders);
    const secondAppleWorkouts = afterSecond.workouts.filter(
      (w) => w.activityType === 'APPLE_HEALTH_SYNC',
    );
    const afterManualCount = afterSecond.workouts.filter(
      (w) => w.activityType !== 'APPLE_HEALTH_SYNC',
    ).length;

    expect(secondAppleWorkouts).toHaveLength(1);
    expect(secondAppleWorkouts[0].activeCalories).toBe(520);
    expect(afterManualCount).toBe(initialManualCount);
    expect(afterSecond.energy.activeCalories).toBe(initialActiveCalories + 520);
    expect(afterSecond.energy.dynamicTdee).toBe(initialDynamicTdee + 520);
    expect(secondBody.target_calories).toBe(afterSecond.energy.targetCalories);
  });

  it('Case 5: tracks GET /api/webhooks/status before/after sync and defaults empty recorded_date to Asia/Bangkok', async () => {
    const { app, authHeaders, apiKey } = await createWebhookTestApp();
    const expectedBangkokDate = getBangkokDateString();

    const beforeStatus = await getWebhookStatus(app, authHeaders);
    expect(beforeStatus).toEqual({
      status: 'NEVER',
      last_synced_at: null,
      synced_fields: [],
    });

    // Omit recorded_date completely -> defaults to Asia/Bangkok calendar date
    const syncRes = await postWebhook(
      app,
      {
        resting_hr: 54,
        active_calories: 250,
      },
      apiKey,
    );
    expect(syncRes.status).toBe(200);
    const syncBody = (await syncRes.json()) as AppleHealthWebhookResponse;
    expect(syncBody.ok).toBe(true);
    expect(syncBody.recorded_date).toBe(expectedBangkokDate);
    expect(syncBody.updated_fields).toEqual(['resting_hr', 'active_calories']);
    expect(new Date(syncBody.synced_at).toISOString()).toBe(syncBody.synced_at);

    const afterStatus = await getWebhookStatus(app, authHeaders);
    expect(afterStatus.status).toBe('SUCCESS');
    expect(afterStatus.last_synced_at).not.toBeNull();
    expect(new Date(afterStatus.last_synced_at!).toISOString()).toBe(
      afterStatus.last_synced_at!,
    );
    expect(afterStatus.synced_fields).toEqual(['resting_hr', 'active_calories']);

    const bangkokDash = await getTodayDashboard(app, expectedBangkokDate, authHeaders);
    expect(bangkokDash.latestMetric.restingHr).toBe(54);

    // Empty-string recorded_date also defaults to Asia/Bangkok
    const emptyDateSyncRes = await postWebhook(
      app,
      {
        recorded_date: '',
        sleep_hours: 8.1,
      },
      apiKey,
    );
    expect(emptyDateSyncRes.status).toBe(200);
    const emptyDateBody = (await emptyDateSyncRes.json()) as AppleHealthWebhookResponse;
    expect(emptyDateBody.recorded_date).toBe(expectedBangkokDate);
    expect(emptyDateBody.updated_fields).toEqual(['sleep_hours']);

    const latestStatus = await getWebhookStatus(app, authHeaders);
    expect(latestStatus.status).toBe('SUCCESS');
    expect(latestStatus.synced_fields).toEqual(['sleep_hours']);
  });

  it('returns 400 for invalid JSON bodies and schema-invalid payloads', async () => {
    const { app, apiKey } = await createWebhookTestApp();

    const malformedRes = await app.request('/api/webhooks/apple-health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: '{invalid-json',
    });
    expect(malformedRes.status).toBe(400);

    const invalidPayloadRes = await postWebhook(
      app,
      {
        recorded_date: 'not-a-date',
        weight_kg: 5,
      },
      apiKey,
    );
    expect(invalidPayloadRes.status).toBe(400);
  });
});
