import { describe, expect, it } from 'bun:test';
import {
  type DashboardBootstrapResponse,
  type DashboardTodayResponse,
  type MeResponseDTO,
  type MonthlyCalendarResponse,
  type ParseNutritionResponse,
  type UpdateSupplementsResponse,
} from '@health-dash/shared';
import type { Hono } from 'hono';
import { createApp } from '../../app';
import { loadRootEnv } from '../../db/load-env';
import {
  getBangkokDateString,
  InMemoryHealthRepository,
  SEED_USER_ID,
} from '../../db/repository';
import { signHs256Jwt } from '../../middleware/auth';
import {
  AiNutritionError,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODELS,
  parseNutritionWithGemini,
  type GeminiGenerateContentFn,
} from '../aiNutrition';

const TEST_JWT_SECRET = 'test-phase5-features-jwt-secret-0123456789abcdef';
const USER_A_ID = 'aaaaaaaa-5555-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B_ID = 'bbbbbbbb-5555-4bbb-8bbb-bbbbbbbbbbbb';
const USER_UNONBOARDED_ID = 'cccccccc-5555-4ccc-8ccc-cccccccccccc';

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
    gender: 'male' | 'female' | 'other';
    birth_date: string;
    height_cm: number;
    weight_kg: number;
    baseline_activity_multiplier: number;
    goal_type: 'CUT' | 'MAINTAIN' | 'BULK';
    calorie_adjustment: number;
    protein_per_kg: number;
    fat_ratio: number;
  }> = {},
): Promise<MeResponseDTO> {
  const payload = {
    name: 'Phase 5 Athlete',
    gender: 'male' as const,
    birth_date: '1995-04-12',
    height_cm: 176,
    weight_kg: 75,
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

function buildValidAiPayload(items: ParseNutritionResponse['items']): string {
  return JSON.stringify({
    suggested_meal_type: 'lunch',
    items,
  });
}

async function withDefaultModelChain<T>(fn: () => Promise<T>): Promise<T> {
  loadRootEnv();
  const previousModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  try {
    return await fn();
  } finally {
    if (previousModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = previousModel;
    }
  }
}

describe('Phase 5: AI Nutrition Parser Accuracy & Reliability Upgrades', () => {
  it('reconciles glaring macro-calorie mismatches (>30% off or 0 kcal with macros > 0) while preserving accurate Nutrition Facts labels', async () => {
    const mockGenerate: GeminiGenerateContentFn = async () => ({
      text: buildValidAiPayload([
        {
          // 0 kcal despite substantial macros -> macroKcal = 25*4 + 10*4 + 4*9 = 176
          food_name: 'ไก่ย่างปรุงรส (0 kcal bug)',
          portion_desc: '1 ชิ้น (100g)',
          calories: 0,
          protein_g: 25,
          carbs_g: 10,
          fat_g: 4,
          confidence: 'MEDIUM',
        },
        {
          // Glaring overestimate: reported 900 kcal vs macroKcal = 20*4 + 30*4 + 10*9 = 290 (>30% off)
          food_name: 'ข้าวผัด (Overestimated kcal)',
          portion_desc: '1 จาน',
          calories: 900,
          protein_g: 20,
          carbs_g: 30,
          fat_g: 10,
          confidence: 'LOW',
        },
        {
          // Glaring underestimate: reported 150 kcal vs macroKcal = 30*4 + 40*4 + 15*9 = 415 (>30% off)
          food_name: 'กะเพราหมูสับ (Underestimated kcal)',
          portion_desc: '1 จาน',
          calories: 150,
          protein_g: 30,
          carbs_g: 40,
          fat_g: 15,
          confidence: 'MEDIUM',
        },
        {
          // Accurate Nutrition Facts label with high fiber (~20% lower than gross 4/4/9): keep label kcal (180)
          // macroKcal = 5*4 + 40*4 + 5*9 = 225; |180-225|/225 = 0.20 <= 0.30
          food_name: 'High-Fiber Protein Bar (Nutrition Label)',
          portion_desc: '1 bar (60g)',
          calories: 180,
          protein_g: 5,
          carbs_g: 40,
          fat_g: 5,
          confidence: 'HIGH',
        },
        {
          // True 0-kcal supplement -> keep 0 kcal
          food_name: 'Creatine Monohydrate',
          portion_desc: '5g scoop',
          calories: 0,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
          confidence: 'HIGH',
        },
      ]),
    });

    const result = await parseNutritionWithGemini(
      { text: 'Test macro calorie reconciliation' },
      { generateContent: mockGenerate },
    );

    expect(result.items).toHaveLength(5);
    expect(result.items[0].calories).toBe(176);
    expect(result.items[1].calories).toBe(290);
    expect(result.items[2].calories).toBe(415);
    expect(result.items[3].calories).toBe(180);
    expect(result.items[4].calories).toBe(0);
  });

  it('falls back cleanly to secondary model when primary stalls past attemptTimeoutMs', async () => {
    await withDefaultModelChain(async () => {
      const calledModels: string[] = [];

      const stallingMock: GeminiGenerateContentFn = async ({ model }) => {
        calledModels.push(model);
        if (model === DEFAULT_GEMINI_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return {
            text: buildValidAiPayload([
              {
                food_name: 'Stale Primary Response',
                portion_desc: '1 unit',
                calories: 100,
                protein_g: 10,
                carbs_g: 10,
                fat_g: 2,
                confidence: 'LOW',
              },
            ]),
          };
        }

        return {
          text: buildValidAiPayload([
            {
              food_name: 'ข้าวสวย',
              portion_desc: '1 ทัพพี (65 กรัม)',
              calories: 80,
              protein_g: 1.7,
              carbs_g: 17.5,
              fat_g: 0.2,
              confidence: 'HIGH',
            },
          ]),
        };
      };

      const result = await parseNutritionWithGemini(
        { text: 'ข้าวสวย 1 ทัพพี' },
        { attemptTimeoutMs: 25, generateContent: stallingMock },
      );

      expect(calledModels).toEqual([DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS[0]]);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].food_name).toBe('ข้าวสวย');
      expect(result.items[0].calories).toBe(80);
    });
  });

  it('falls back on empty or malformed JSON from primary model and throws 502 INVALID_AI_RESPONSE if all candidates fail', async () => {
    await withDefaultModelChain(async () => {
      // 1) Primary returns empty string -> fallback succeeds
      const emptyPrimaryModels: string[] = [];
      const emptyFallbackMock: GeminiGenerateContentFn = async ({ model }) => {
        emptyPrimaryModels.push(model);
        if (model === DEFAULT_GEMINI_MODEL) {
          return { text: '   ' };
        }
        return {
          text: buildValidAiPayload([
            {
              food_name: 'ไข่ต้ม',
              portion_desc: '2 ฟอง',
              calories: 144,
              protein_g: 12.6,
              carbs_g: 1.2,
              fat_g: 10,
              confidence: 'HIGH',
            },
          ]),
        };
      };

      const emptyFallbackResult = await parseNutritionWithGemini(
        { text: 'ไข่ต้ม 2 ฟอง' },
        { generateContent: emptyFallbackMock },
      );
      expect(emptyPrimaryModels).toEqual([DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS[0]]);
      expect(emptyFallbackResult.items[0].food_name).toBe('ไข่ต้ม');

      // 2) Primary returns malformed JSON -> fallback succeeds
      const malformedPrimaryModels: string[] = [];
      const malformedFallbackMock: GeminiGenerateContentFn = async ({ model }) => {
        malformedPrimaryModels.push(model);
        if (model === DEFAULT_GEMINI_MODEL) {
          return { text: '{"items": [broken json' };
        }
        return {
          text: buildValidAiPayload([
            {
              food_name: 'อกไก่ย่าง',
              portion_desc: '100 กรัม',
              calories: 165,
              protein_g: 31,
              carbs_g: 0,
              fat_g: 3.6,
              confidence: 'HIGH',
            },
          ]),
        };
      };

      const malformedFallbackResult = await parseNutritionWithGemini(
        { text: 'อกไก่ย่าง 100g' },
        { generateContent: malformedFallbackMock },
      );
      expect(malformedPrimaryModels).toEqual([DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS[0]]);
      expect(malformedFallbackResult.items[0].food_name).toBe('อกไก่ย่าง');

      // 3) All candidates return malformed JSON -> throws 502 INVALID_AI_RESPONSE
      const allMalformedModels: string[] = [];
      const allMalformedMock: GeminiGenerateContentFn = async ({ model }) => {
        allMalformedModels.push(model);
        return { text: '{still-invalid-json' };
      };

      let caught: unknown;
      try {
        await parseNutritionWithGemini(
          { text: 'ส้มตำไทย' },
          { generateContent: allMalformedMock },
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(AiNutritionError);
      const aiErr = caught as AiNutritionError;
      expect(aiErr.statusCode).toBe(502);
      expect(aiErr.code).toBe('INVALID_AI_RESPONSE');
      expect(allMalformedModels).toEqual([DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS]);

      // 4) Primary returns schema-invalid JSON -> fallback succeeds
      const schemaFallbackModels: string[] = [];
      const schemaFallbackMock: GeminiGenerateContentFn = async ({ model }) => {
        schemaFallbackModels.push(model);
        if (model === DEFAULT_GEMINI_MODEL) {
          return {
            text: JSON.stringify({
              suggested_meal_type: 'lunch',
              items: [
                {
                  food_name: 'ข้าวสวย',
                  portion_desc: '1 จาน',
                  calories: 250,
                  protein_g: 5,
                  carbs_g: 54,
                  fat_g: 0.4,
                  confidence: 'INVALID_CONFIDENCE',
                },
              ],
            }),
          };
        }
        return {
          text: buildValidAiPayload([
            {
              food_name: 'ข้าวสวย',
              portion_desc: '1 จาน (200g)',
              calories: 260,
              protein_g: 5.2,
              carbs_g: 56.2,
              fat_g: 0.4,
              confidence: 'HIGH',
            },
          ]),
        };
      };

      const schemaFallbackResult = await parseNutritionWithGemini(
        { text: 'ข้าวสวย 1 จาน' },
        { generateContent: schemaFallbackMock },
      );
      expect(schemaFallbackModels).toEqual([DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS[0]]);
      expect(schemaFallbackResult.items[0].confidence).toBe('HIGH');

      // 5) All candidates time out -> throws 502 UPSTREAM_ERROR
      const allTimeoutModels: string[] = [];
      const allTimeoutMock: GeminiGenerateContentFn = async ({ model }) => {
        allTimeoutModels.push(model);
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { text: buildValidAiPayload([]) };
      };

      let timeoutErr: unknown;
      try {
        await parseNutritionWithGemini(
          { text: 'ชานมไข่มุก' },
          { attemptTimeoutMs: 15, generateContent: allTimeoutMock },
        );
      } catch (err) {
        timeoutErr = err;
      }

      expect(timeoutErr).toBeInstanceOf(AiNutritionError);
      expect((timeoutErr as AiNutritionError).statusCode).toBe(502);
      expect((timeoutErr as AiNutritionError).code).toBe('UPSTREAM_ERROR');
      expect(allTimeoutModels).toEqual([DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS]);
    });
  });
});

describe('Phase 5: Custom Supplements (PUT /api/settings/supplements)', () => {
  it('updates Creatine dosage to 10g, adds Vitamin C, preserves existing toggles by key, and reflects in GET /api/dashboard/today', async () => {
    const { app, today } = createTestContext();
    const headers = makeAuthHeaders(SEED_USER_ID);

    const beforeRes = await app.request(`/api/dashboard/today?date=${today}`, { headers });
    expect(beforeRes.status).toBe(200);
    const before = (await beforeRes.json()) as DashboardTodayResponse;
    expect(before.supplements.find((s) => s.key === 'creatine')?.dosage).toBe('5g');
    expect(before.supplements.find((s) => s.key === 'creatine')?.taken).toBe(true);
    expect(before.supplements.find((s) => s.key === 'vit_d3k2')?.taken).toBe(true);
    expect(before.supplements.find((s) => s.key === 'omega3')?.taken).toBe(true);
    expect(before.supplements.find((s) => s.key === 'magnesium')?.taken).toBe(false);

    const updatedStack = before.profile.supplementStack.map((item) =>
      item.key === 'creatine' ? { ...item, dosage: '10g' } : item,
    );
    updatedStack.push({
      key: 'vitamin_c',
      name: 'Vitamin C',
      dosage: '1000mg',
      timing: 'With breakfast',
    });

    const putRes = await app.request('/api/settings/supplements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ supplements: updatedStack }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as UpdateSupplementsResponse;
    expect(putBody.supplementStack).toHaveLength(before.profile.supplementStack.length + 1);
    expect(putBody.supplementStack.find((s) => s.key === 'creatine')?.dosage).toBe('10g');
    expect(putBody.supplementStack.find((s) => s.key === 'vitamin_c')?.dosage).toBe('1000mg');

    const afterRes = await app.request(`/api/dashboard/today?date=${today}`, { headers });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as DashboardTodayResponse;

    const creatine = after.supplements.find((s) => s.key === 'creatine');
    const vitD = after.supplements.find((s) => s.key === 'vit_d3k2');
    const omega3 = after.supplements.find((s) => s.key === 'omega3');
    const magnesium = after.supplements.find((s) => s.key === 'magnesium');
    const vitaminC = after.supplements.find((s) => s.key === 'vitamin_c');

    expect(creatine?.dosage).toBe('10g');
    expect(creatine?.taken).toBe(true);
    expect(vitD?.taken).toBe(true);
    expect(omega3?.taken).toBe(true);
    expect(magnesium?.taken).toBe(false);
    expect(vitaminC).toEqual({
      key: 'vitamin_c',
      name: 'Vitamin C',
      dosage: '1000mg',
      timing: 'With breakfast',
      taken: false,
    });

    // Newly added custom supplement can be toggled cleanly by key
    const toggleRes = await app.request('/api/supplements/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ supplementKey: 'vitamin_c', loggedDate: today }),
    });
    expect(toggleRes.status).toBe(200);

    const toggledDashRes = await app.request(`/api/dashboard/today?date=${today}`, { headers });
    expect(toggledDashRes.status).toBe(200);
    const toggledDash = (await toggledDashRes.json()) as DashboardTodayResponse;
    expect(toggledDash.supplements.find((s) => s.key === 'vitamin_c')?.taken).toBe(true);
  });

  it('rejects duplicate supplement keys with 400 and isolates User A from User B', async () => {
    const { app, today } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID);
    const userBHeaders = makeAuthHeaders(USER_B_ID);

    await onboardUser(app, userAHeaders, { name: 'User A' });
    await onboardUser(app, userBHeaders, { name: 'User B' });

    const duplicateRes = await app.request('/api/settings/supplements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        supplements: [
          { key: 'vitamin_c', name: 'Vitamin C AM', dosage: '500mg', timing: 'Morning' },
          { key: 'vitamin_c', name: 'Vitamin C PM', dosage: '500mg', timing: 'Night' },
        ],
      }),
    });
    expect(duplicateRes.status).toBe(400);

    const userAUpdateRes = await app.request('/api/settings/supplements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        supplements: [
          { key: 'creatine', name: 'Creatine Monohydrate', dosage: '10g', timing: 'Daily' },
          { key: 'vitamin_c', name: 'Vitamin C', dosage: '1000mg', timing: 'Breakfast' },
        ],
      }),
    });
    expect(userAUpdateRes.status).toBe(200);

    const userADashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    const userBDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userBHeaders,
    });
    expect(userADashRes.status).toBe(200);
    expect(userBDashRes.status).toBe(200);

    const userADash = (await userADashRes.json()) as DashboardTodayResponse;
    const userBDash = (await userBDashRes.json()) as DashboardTodayResponse;

    expect(userADash.supplements.map((s) => s.key)).toEqual(['creatine', 'vitamin_c']);
    expect(userBDash.supplements.some((s) => s.key === 'vitamin_c')).toBe(false);
    expect(userBDash.supplements.find((s) => s.key === 'creatine')?.dosage).toBe('5g');
  });
});

describe('Phase 5: Profile & Goal Settings (PATCH /api/settings/profile)', () => {
  it('updates goal CUT -> BULK and recalculates GET /api/me and GET /api/dashboard/today targets immediately', async () => {
    const { app, today } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID);

    await onboardUser(app, userAHeaders, {
      name: 'User A',
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

    const beforeDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    expect(beforeDashRes.status).toBe(200);
    const beforeDash = (await beforeDashRes.json()) as DashboardTodayResponse;
    expect(beforeDash.goal.goalType).toBe('CUT');
    expect(beforeDash.energy.targetCalories).toBe(beforeDash.energy.dynamicTdee - 350);
    expect(beforeDash.macros.protein.target).toBe(Math.round(75 * 2.0));

    const patchRes = await app.request('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        name: 'User A Bulk',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.55,
        goal_type: 'BULK',
        calorie_adjustment: 300,
        protein_per_kg: 2.2,
        fat_ratio: 0.25,
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchedMe = (await patchRes.json()) as MeResponseDTO;
    expect(patchedMe.profile?.name).toBe('User A Bulk');
    expect(patchedMe.profile?.baselineActivityMultiplier).toBe(1.55);
    expect(patchedMe.goal?.goalType).toBe('BULK');
    expect(patchedMe.goal?.calorieAdjustment).toBe(300);
    expect(patchedMe.goal?.proteinPerKg).toBe(2.2);

    const getMeRes = await app.request('/api/me', { headers: userAHeaders });
    expect(getMeRes.status).toBe(200);
    const getMe = (await getMeRes.json()) as MeResponseDTO;
    expect(getMe.profile?.baselineActivityMultiplier).toBe(1.55);
    expect(getMe.goal?.goalType).toBe('BULK');
    expect(getMe.goal?.calorieAdjustment).toBe(300);
    expect(getMe.goal?.proteinPerKg).toBe(2.2);

    const afterDashRes = await app.request(`/api/dashboard/today?date=${today}`, {
      headers: userAHeaders,
    });
    expect(afterDashRes.status).toBe(200);
    const afterDash = (await afterDashRes.json()) as DashboardTodayResponse;

    const expectedBaselineTdee = Math.round(afterDash.energy.bmr * 1.55);
    const expectedTargetCalories = expectedBaselineTdee + 300;
    const expectedProteinTarget = Math.round(75 * 2.2);
    const expectedFatTarget = Math.round((expectedTargetCalories * 0.25) / 9);
    const expectedCarbsTarget = Math.max(
      0,
      Math.round((expectedTargetCalories - expectedProteinTarget * 4 - expectedFatTarget * 9) / 4),
    );

    expect(afterDash.goal.goalType).toBe('BULK');
    expect(afterDash.energy.baselineTdee).toBe(expectedBaselineTdee);
    expect(afterDash.energy.targetCalories).toBe(expectedTargetCalories);
    expect(afterDash.energy.targetCalories).toBeGreaterThan(beforeDash.energy.targetCalories);
    expect(afterDash.macros.protein.target).toBe(expectedProteinTarget);
    expect(afterDash.macros.fat.target).toBe(expectedFatTarget);
    expect(afterDash.macros.carbs.target).toBe(expectedCarbsTarget);
  });

  it('rejects out-of-bounds profile and goal settings with 400', async () => {
    const { app } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID);
    await onboardUser(app, userAHeaders);

    const invalidPayloads = [
      {
        name: 'Bad Activity',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 3.0,
        goal_type: 'BULK',
        calorie_adjustment: 300,
        protein_per_kg: 2.2,
        fat_ratio: 0.25,
      },
      {
        name: 'Bad Adjustment',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.55,
        goal_type: 'BULK',
        calorie_adjustment: 2000,
        protein_per_kg: 2.2,
        fat_ratio: 0.25,
      },
      {
        name: 'Bad Protein',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.55,
        goal_type: 'BULK',
        calorie_adjustment: 300,
        protein_per_kg: 5.0,
        fat_ratio: 0.25,
      },
      {
        name: 'Bad Fat Ratio',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.55,
        goal_type: 'BULK',
        calorie_adjustment: 300,
        protein_per_kg: 2.2,
        fat_ratio: 0.75,
      },
    ];

    for (const payload of invalidPayloads) {
      const res = await app.request('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...userAHeaders },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe('Phase 5: Monthly Calendar (GET /api/dashboard/calendar)', () => {
  it('returns accurate daily summaries, unweighed weightKg=null, status/rollups, strict userId isolation, and validates month query', async () => {
    const { app } = createTestContext();
    const userAHeaders = makeAuthHeaders(USER_A_ID);
    const userBHeaders = makeAuthHeaders(USER_B_ID);

    await onboardUser(app, userAHeaders, {
      name: 'Calendar User A',
      gender: 'male',
      birth_date: '1995-04-12',
      height_cm: 176,
      weight_kg: 74,
      baseline_activity_multiplier: 1.35,
      goal_type: 'CUT',
      calorie_adjustment: -350,
      protein_per_kg: 2.0,
      fat_ratio: 0.25,
    });
    await onboardUser(app, userBHeaders, { name: 'Calendar User B' });

    // Log deterministic activity for User A in 2026-10
    // Day 2026-10-05: weighed (74.0 kg, 16.0% BF), 1 workout (400 kcal), 2 meals (2150 kcal), 2 supplements
    const metricRes = await app.request('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        weightKg: 74.0,
        bodyFatPct: 16.0,
        recordedDate: '2026-10-05',
      }),
    });
    expect(metricRes.status).toBe(201);

    const workoutRes = await app.request('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        activityName: 'Upper Strength',
        category: 'strength',
        durationMin: 55,
        activeCalories: 400,
        intensity: 'high',
        loggedDate: '2026-10-05',
      }),
    });
    expect(workoutRes.status).toBe(201);

    const meal1Res = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        itemName: 'Lunch Bowl',
        mealType: 'lunch',
        calories: 1150,
        proteinG: 80,
        carbsG: 120,
        fatG: 35,
        loggedDate: '2026-10-05',
      }),
    });
    expect(meal1Res.status).toBe(201);

    const meal2Res = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        itemName: 'Dinner Salmon',
        mealType: 'dinner',
        calories: 1000,
        proteinG: 70,
        carbsG: 90,
        fatG: 35,
        loggedDate: '2026-10-05',
      }),
    });
    expect(meal2Res.status).toBe(201);

    for (const key of ['creatine', 'vit_d3k2']) {
      const suppRes = await app.request('/api/supplements/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...userAHeaders },
        body: JSON.stringify({ supplementKey: key, loggedDate: '2026-10-05' }),
      });
      expect(suppRes.status).toBe(200);
    }

    // Day 2026-10-06: NO body metric logged (weightKg must stay null), overload meal (3500 kcal)
    const overloadMealRes = await app.request('/api/nutrition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userAHeaders },
      body: JSON.stringify({
        itemName: 'Cheat Feast',
        mealType: 'dinner',
        calories: 3500,
        proteinG: 120,
        carbsG: 400,
        fatG: 140,
        loggedDate: '2026-10-06',
      }),
    });
    expect(overloadMealRes.status).toBe(201);

    const calARes = await app.request('/api/dashboard/calendar?month=2026-10', {
      headers: userAHeaders,
    });
    expect(calARes.status).toBe(200);
    const calA = (await calARes.json()) as MonthlyCalendarResponse;

    expect(calA.month).toBe('2026-10');
    expect(calA.daysInMonth).toBe(31);
    expect(calA.days).toHaveLength(31);
    expect(calA.days[0].date).toBe('2026-10-01');
    expect(calA.days[30].date).toBe('2026-10-31');

    const day05 = calA.days.find((d) => d.date === '2026-10-05')!;
    expect(day05).toBeDefined();
    expect(day05.hasData).toBe(true);
    expect(day05.consumedCalories).toBe(2150);
    expect(day05.mealCount).toBe(2);
    expect(day05.workoutCount).toBe(1);
    expect(day05.activeCalories).toBe(400);
    expect(day05.supplementsTaken).toBe(2);
    expect(day05.supplementsTotal).toBe(5);
    expect(day05.weightKg).toBe(74);
    expect(day05.bodyFatPct).toBe(16);
    expect(day05.status).toBe('optimal');

    const day06 = calA.days.find((d) => d.date === '2026-10-06')!;
    expect(day06).toBeDefined();
    expect(day06.hasData).toBe(true);
    expect(day06.consumedCalories).toBe(3500);
    expect(day06.workoutCount).toBe(0);
    expect(day06.activeCalories).toBe(0);
    expect(day06.supplementsTaken).toBe(0);
    expect(day06.weightKg).toBeNull();
    expect(day06.bodyFatPct).toBeNull();
    expect(day06.status).toBe('overload');

    const day07 = calA.days.find((d) => d.date === '2026-10-07')!;
    expect(day07).toBeDefined();
    expect(day07.hasData).toBe(false);
    expect(day07.status).toBe('empty');
    expect(day07.consumedCalories).toBe(0);
    expect(day07.workoutCount).toBe(0);
    expect(day07.activeCalories).toBe(0);
    expect(day07.supplementsTaken).toBe(0);
    expect(day07.weightKg).toBeNull();

    expect(calA.summary.loggedDays).toBe(2);
    expect(calA.summary.optimalDays).toBe(1);
    expect(calA.summary.moderateDays).toBe(0);
    expect(calA.summary.overloadDays).toBe(1);
    expect(calA.summary.avgCalories).toBe(Math.round((2150 + 3500) / 2));
    expect(calA.summary.avgProteinG).toBe(Math.round((150 + 120) / 2));
    expect(calA.summary.totalActiveCalories).toBe(400);
    expect(calA.summary.avgWeightKg).toBe(74);
    expect(calA.summary.supplementAdherencePct).toBe(20);

    // Default month query (omitted) returns current Bangkok month for seed user
    const defaultCalRes = await app.request('/api/dashboard/calendar', {
      headers: makeAuthHeaders(SEED_USER_ID),
    });
    expect(defaultCalRes.status).toBe(200);
    const defaultCal = (await defaultCalRes.json()) as MonthlyCalendarResponse;
    expect(defaultCal.month).toBe(getBangkokDateString().slice(0, 7));
    expect(defaultCal.days).toHaveLength(defaultCal.daysInMonth);
    expect(defaultCal.summary.loggedDays).toBeGreaterThan(0);

    // Strict userId isolation: User B has no data in 2026-10
    const calBRes = await app.request('/api/dashboard/calendar?month=2026-10', {
      headers: userBHeaders,
    });
    expect(calBRes.status).toBe(200);
    const calB = (await calBRes.json()) as MonthlyCalendarResponse;
    expect(calB.daysInMonth).toBe(31);
    expect(calB.summary.loggedDays).toBe(0);
    expect(calB.summary.totalActiveCalories).toBe(0);
    expect(calB.summary.avgWeightKg).toBeNull();
    for (const day of calB.days) {
      expect(day.hasData).toBe(false);
      expect(day.status).toBe('empty');
      expect(day.consumedCalories).toBe(0);
      expect(day.workoutCount).toBe(0);
      expect(day.weightKg).toBeNull();
    }

    // Invalid month query returns 400
    for (const badMonth of ['2026-13', '2026-00', 'invalid']) {
      const badRes = await app.request(`/api/dashboard/calendar?month=${badMonth}`, {
        headers: userAHeaders,
      });
      expect(badRes.status).toBe(400);
    }
  });
});

describe('Phase 5: Bootstrap Endpoint (GET /api/dashboard/bootstrap)', () => {
  it('returns { me, dashboard, trends, syncStatus } for onboarded user and null dashboard/trends for un-onboarded user', async () => {
    const { app } = createTestContext();

    // Un-onboarded user gets onboarded: false with null dashboard & trends
    const unonboardedHeaders = makeAuthHeaders(USER_UNONBOARDED_ID);
    const unonboardedRes = await app.request('/api/dashboard/bootstrap?days=30', {
      headers: unonboardedHeaders,
    });
    expect(unonboardedRes.status).toBe(200);
    const unonboardedBody = (await unonboardedRes.json()) as DashboardBootstrapResponse;
    expect(unonboardedBody.me.userId).toBe(USER_UNONBOARDED_ID);
    expect(unonboardedBody.me.onboarded).toBe(false);
    expect(unonboardedBody.me.profile).toBeNull();
    expect(unonboardedBody.me.goal).toBeNull();
    expect(unonboardedBody.dashboard).toBeNull();
    expect(unonboardedBody.trends).toBeNull();
    expect(unonboardedBody.syncStatus).toEqual({
      status: 'NEVER',
      last_synced_at: null,
      synced_fields: [],
    });

    // Onboarded seed user gets complete hydrated bootstrap payload in 1 request
    const seedHeaders = makeAuthHeaders(SEED_USER_ID);
    const onboardedRes = await app.request('/api/dashboard/bootstrap?days=30', {
      headers: seedHeaders,
    });
    expect(onboardedRes.status).toBe(200);
    const onboardedBody = (await onboardedRes.json()) as DashboardBootstrapResponse;

    expect(onboardedBody.me.userId).toBe(SEED_USER_ID);
    expect(onboardedBody.me.onboarded).toBe(true);
    expect(onboardedBody.me.profile?.id).toBe(SEED_USER_ID);
    expect(onboardedBody.me.goal?.isActive).toBe(true);

    expect(onboardedBody.dashboard).not.toBeNull();
    expect(onboardedBody.dashboard!.profile.id).toBe(SEED_USER_ID);
    expect(onboardedBody.dashboard!.supplements).toHaveLength(5);
    expect(onboardedBody.dashboard!.meals.length).toBeGreaterThan(0);

    expect(onboardedBody.trends).not.toBeNull();
    expect(onboardedBody.trends!.days).toBe(30);
    expect(onboardedBody.trends!.points).toHaveLength(30);

    expect(onboardedBody.syncStatus).toEqual({
      status: 'NEVER',
      last_synced_at: null,
      synced_fields: [],
    });

    // Invalid days query returns 400
    const badDaysRes = await app.request('/api/dashboard/bootstrap?days=2', {
      headers: seedHeaders,
    });
    expect(badDaysRes.status).toBe(400);
  });

  it('enforces 401 auth on all Phase 5 routes and 404 when un-onboarded users hit profile/supplement/calendar routes', async () => {
    const { app } = createTestContext();

    const unauthRoutes: Array<{ path: string; method: 'GET' | 'PUT' | 'PATCH'; body?: string }> = [
      {
        path: '/api/settings/supplements',
        method: 'PUT',
        body: JSON.stringify({ supplements: [] }),
      },
      {
        path: '/api/settings/profile',
        method: 'PATCH',
        body: JSON.stringify({}),
      },
      { path: '/api/dashboard/calendar?month=2026-10', method: 'GET' },
      { path: '/api/dashboard/bootstrap?days=30', method: 'GET' },
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

    const unonboardedHeaders = makeAuthHeaders(USER_UNONBOARDED_ID);

    const supp404 = await app.request('/api/settings/supplements', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...unonboardedHeaders },
      body: JSON.stringify({
        supplements: [{ key: 'creatine', name: 'Creatine', dosage: '5g', timing: 'Daily' }],
      }),
    });
    expect(supp404.status).toBe(404);

    const profile404 = await app.request('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...unonboardedHeaders },
      body: JSON.stringify({
        name: 'No Profile',
        gender: 'male',
        birth_date: '1995-04-12',
        height_cm: 176,
        baseline_activity_multiplier: 1.35,
        goal_type: 'CUT',
        calorie_adjustment: -350,
        protein_per_kg: 2.0,
        fat_ratio: 0.25,
      }),
    });
    expect(profile404.status).toBe(404);

    const cal404 = await app.request('/api/dashboard/calendar?month=2026-10', {
      headers: unonboardedHeaders,
    });
    expect(cal404.status).toBe(404);
  });
});
