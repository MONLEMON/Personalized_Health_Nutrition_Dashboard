import { describe, expect, it } from 'bun:test';
import {
  ParseNutritionResponseSchema,
  type DashboardTodayResponse,
  type NutritionLogDTO,
  type ParseNutritionResponse,
} from '@health-dash/shared';
import { createApp } from '../../app';
import { loadRootEnv } from '../../db/load-env';
import { InMemoryHealthRepository, SEED_USER_ID } from '../../db/repository';
import { signHs256Jwt } from '../../middleware/auth';
import {
  AiNutritionError,
  MAX_NUTRITION_IMAGE_BYTES,
  parseNutritionWithGemini,
  type GeminiGenerateContentFn,
  type ParseNutritionInput,
} from '../aiNutrition';

async function expectAiNutritionError(
  promise: Promise<unknown>,
  expectedStatus: 400 | 413 | 502 | 503,
  expectedCode:
    | 'MISSING_API_KEY'
    | 'INVALID_INPUT'
    | 'FILE_TOO_LARGE'
    | 'UNSUPPORTED_MEDIA_TYPE'
    | 'INVALID_AI_RESPONSE'
    | 'UPSTREAM_ERROR',
): Promise<AiNutritionError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AiNutritionError);
    const aiErr = err as AiNutritionError;
    expect(aiErr.statusCode).toBe(expectedStatus);
    expect(aiErr.code).toBe(expectedCode);
    return aiErr;
  }
  throw new Error(
    `Expected AiNutritionError(${expectedStatus}, ${expectedCode}), but promise resolved.`,
  );
}

describe('parseNutritionWithGemini Unit & Error-Handling Tests', () => {
  it('throws 503 MISSING_API_KEY when apiKey is empty', async () => {
    const err = await expectAiNutritionError(
      parseNutritionWithGemini({ text: 'ข้าวผัดกะเพราไก่ไข่ดาว' }, { apiKey: '' }),
      503,
      'MISSING_API_KEY',
    );
    expect(err.message).toContain('GEMINI_API_KEY');
  });

  it('throws 400 INVALID_INPUT when both text and image are empty or missing', async () => {
    await expectAiNutritionError(
      parseNutritionWithGemini({}, { apiKey: 'test-key' }),
      400,
      'INVALID_INPUT',
    );

    await expectAiNutritionError(
      parseNutritionWithGemini(
        {
          text: '   \n\t ',
          image: { base64: '   ', mimeType: 'image/jpeg' },
        },
        { apiKey: 'test-key' },
      ),
      400,
      'INVALID_INPUT',
    );
  });

  it('throws 400 UNSUPPORTED_MEDIA_TYPE and 413 FILE_TOO_LARGE for invalid images', async () => {
    await expectAiNutritionError(
      parseNutritionWithGemini(
        {
          image: {
            base64: Buffer.from('not-an-image').toString('base64'),
            mimeType: 'application/pdf',
          },
        },
        { apiKey: 'test-key' },
      ),
      400,
      'UNSUPPORTED_MEDIA_TYPE',
    );

    const oversizedBase64 = Buffer.alloc(MAX_NUTRITION_IMAGE_BYTES + 1, 1).toString('base64');
    await expectAiNutritionError(
      parseNutritionWithGemini(
        {
          image: {
            base64: oversizedBase64,
            mimeType: 'image/jpeg',
          },
        },
        { apiKey: 'test-key' },
      ),
      413,
      'FILE_TOO_LARGE',
    );
  });

  it('throws 502 INVALID_AI_RESPONSE when AI returns invalid JSON or empty text', async () => {
    const invalidJsonMock: GeminiGenerateContentFn = async () => ({
      text: '{not valid json',
    });

    await expectAiNutritionError(
      parseNutritionWithGemini(
        { text: 'ข้าวมันไก่ต้ม' },
        { generateContent: invalidJsonMock },
      ),
      502,
      'INVALID_AI_RESPONSE',
    );

    const emptyTextMock: GeminiGenerateContentFn = async () => ({
      text: '   ',
    });

    await expectAiNutritionError(
      parseNutritionWithGemini(
        { text: 'ข้าวมันไก่ต้ม' },
        { generateContent: emptyTextMock },
      ),
      502,
      'INVALID_AI_RESPONSE',
    );
  });

  it('throws 502 INVALID_AI_RESPONSE when AI JSON fails ParseNutritionResponseSchema', async () => {
    const invalidConfidenceMock: GeminiGenerateContentFn = async () => ({
      text: JSON.stringify({
        suggested_meal_type: 'lunch',
        items: [
          {
            food_name: 'กะเพราหมูสับ',
            portion_desc: '1 จาน',
            calories: 520,
            protein_g: 24,
            carbs_g: 55,
            fat_g: 22,
            confidence: 'SUPER',
          },
        ],
      }),
    });

    await expectAiNutritionError(
      parseNutritionWithGemini(
        { text: 'กะเพราหมูสับ' },
        { generateContent: invalidConfidenceMock },
      ),
      502,
      'INVALID_AI_RESPONSE',
    );

    const missingFoodNameMock: GeminiGenerateContentFn = async () => ({
      text: JSON.stringify({
        suggested_meal_type: 'dinner',
        items: [
          {
            portion_desc: '1 ถ้วย',
            calories: 300,
            protein_g: 15,
            carbs_g: 40,
            fat_g: 8,
            confidence: 'MEDIUM',
          },
        ],
      }),
    });

    await expectAiNutritionError(
      parseNutritionWithGemini(
        { text: 'ก๋วยเตี๋ยวน้ำใส' },
        { generateContent: missingFoodNameMock },
      ),
      502,
      'INVALID_AI_RESPONSE',
    );
  });

  it('wraps upstream SDK failures in 502 UPSTREAM_ERROR and redacts API keys', async () => {
    const secretKey = ['AIza', 'SyDummySecretKey1234567890abcd'].join('');
    const failingMock: GeminiGenerateContentFn = async () => {
      throw new Error(`Upstream failure with ?key=${secretKey} and ${secretKey}`);
    };

    const err = await expectAiNutritionError(
      parseNutritionWithGemini(
        { text: 'อกไก่ปั่น' },
        { apiKey: secretKey, generateContent: failingMock },
      ),
      502,
      'UPSTREAM_ERROR',
    );

    expect(err.message).not.toContain(secretKey);
    expect(err.message).toContain('[REDACTED]');
  });

  it('automatically falls back to gemini-flash-lite-latest when primary model hits 503 UNAVAILABLE', async () => {
    loadRootEnv();
    const prevModel = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    const calledModels: string[] = [];

    const fallbackMock: GeminiGenerateContentFn = async ({ model }) => {
      calledModels.push(model);
      if (model === 'gemini-3.8-flash') {
        throw new Error(
          '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
        );
      }
      return {
        text: JSON.stringify({
          suggested_meal_type: 'lunch',
          items: [
            {
              food_name: 'ข้าวสวย',
              portion_desc: '200 กรัม',
              calories: 260,
              protein_g: 5.2,
              carbs_g: 56.2,
              fat_g: 0.5,
              confidence: 'HIGH',
            },
          ],
        }),
      };
    };

    try {
      const result = await parseNutritionWithGemini(
        { text: 'ข้าวสวย 200 กรัม' },
        { generateContent: fallbackMock },
      );

      expect(calledModels).toEqual(['gemini-3.8-flash', 'gemini-flash-lite-latest']);
      expect(result.suggested_meal_type).toBe('lunch');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].food_name).toBe('ข้าวสวย');
    } finally {
      if (prevModel === undefined) {
        delete process.env.GEMINI_MODEL;
      } else {
        process.env.GEMINI_MODEL = prevModel;
      }
    }
  });

  it('parses valid Thai meal text + inlineData image into schema-validated output', async () => {
    const sampleImageBase64 = Buffer.from('mock-jpeg-image-bytes').toString('base64');
    let capturedParams: Parameters<GeminiGenerateContentFn>[0] | null = null;

    const validMock: GeminiGenerateContentFn = async (params) => {
      capturedParams = params;
      return {
        text: JSON.stringify({
          suggested_meal_type: 'lunch',
          items: [
            {
              food_name: 'ข้าวสวย',
              portion_desc: '1 จาน (200 กรัม)',
              calories: 260.4,
              protein_g: 5.24,
              carbs_g: 56.18,
              fat_g: 0.44,
              confidence: 'HIGH',
            },
            {
              food_name: 'กะเพราอกไก่ + ไข่ดาว',
              portion_desc: '1 ที่',
              calories: 385.6,
              protein_g: 34.76,
              carbs_g: 12.12,
              fat_g: 21.35,
              confidence: 'MEDIUM',
            },
          ],
        }),
      };
    };

    const result = await parseNutritionWithGemini(
      {
        text: 'ข้าวสวย 200 กรัม กะเพราอกไก่ ไข่ดาว',
        image: {
          base64: sampleImageBase64,
          mimeType: 'image/jpeg',
        },
      },
      { generateContent: validMock },
    );

    expect(ParseNutritionResponseSchema.safeParse(result).success).toBe(true);
    expect(result.suggested_meal_type).toBe('lunch');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      food_name: 'ข้าวสวย',
      portion_desc: '1 จาน (200 กรัม)',
      calories: 260,
      protein_g: 5.2,
      carbs_g: 56.2,
      fat_g: 0.4,
      confidence: 'HIGH',
    });
    expect(result.items[1]).toEqual({
      food_name: 'กะเพราอกไก่ + ไข่ดาว',
      portion_desc: '1 ที่',
      calories: 386,
      protein_g: 34.8,
      carbs_g: 12.1,
      fat_g: 21.4,
      confidence: 'MEDIUM',
    });

    expect(capturedParams).not.toBeNull();
    expect(capturedParams!.config.responseMimeType).toBe('application/json');
    expect(capturedParams!.config.responseSchema).toBeDefined();
    expect(capturedParams!.contents).toEqual([
      { text: 'ข้าวสวย 200 กรัม กะเพราอกไก่ ไข่ดาว' },
      {
        inlineData: {
          data: sampleImageBase64,
          mimeType: 'image/jpeg',
        },
      },
    ]);
  });
});

describe('Nutrition AI & Batch HTTP Route Tests (app.request)', () => {
  const TEST_JWT_SECRET = 'test-jwt-secret-ai-nutrition-0123456789';
  const makeAuthHeaders = (userId: string = SEED_USER_ID) => ({
    Authorization: `Bearer ${signHs256Jwt({ sub: userId }, TEST_JWT_SECRET)}`,
  });

  it('POST /api/nutrition/parse returns 503 MISSING_API_KEY when GEMINI_API_KEY is unset/empty', async () => {
    // Ensure loadRootEnv has run so restoring/clearing process.env is deterministic even if a local .env exists.
    loadRootEnv();
    const previousApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    const authHeaders = makeAuthHeaders();

    try {
      const defaultApp = createApp(new InMemoryHealthRepository(), {
        jwtSecret: TEST_JWT_SECRET,
      });
      const formData = new FormData();
      formData.append('text', 'ข้าวสวย อกไก่ย่าง ไข่ต้ม 2 ฟอง');

      const res = await defaultApp.request('/api/nutrition/parse', {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      expect(res.status).toBe(503);

      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe('MISSING_API_KEY');
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);

      // Also verify explicit empty apiKey via DI wrapper
      const explicitApp = createApp(new InMemoryHealthRepository(), {
        jwtSecret: TEST_JWT_SECRET,
        parseNutrition: (input) => parseNutritionWithGemini(input, { apiKey: '' }),
      });
      const explicitForm = new FormData();
      explicitForm.append('text', 'ส้มตำไทย');
      const explicitRes = await explicitApp.request('/api/nutrition/parse', {
        method: 'POST',
        headers: authHeaders,
        body: explicitForm,
      });
      expect(explicitRes.status).toBe(503);
      const explicitBody = (await explicitRes.json()) as { error: string; code: string };
      expect(explicitBody.code).toBe('MISSING_API_KEY');
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousApiKey;
      }
    }
  });

  it('POST /api/nutrition/parse returns 400 on empty FormData', async () => {
    let parserCalled = false;
    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
      parseNutrition: async () => {
        parserCalled = true;
        return { suggested_meal_type: 'snack', items: [] };
      },
    });

    const res = await app.request('/api/nutrition/parse', {
      method: 'POST',
      headers: makeAuthHeaders(),
      body: new FormData(),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_INPUT');
    expect(parserCalled).toBe(false);
  });

  it('POST /api/nutrition/parse returns 413 FILE_TOO_LARGE for oversized image (> 5MB)', async () => {
    let parserCalled = false;
    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
      parseNutrition: async () => {
        parserCalled = true;
        return { suggested_meal_type: 'snack', items: [] };
      },
    });

    const formData = new FormData();
    const oversizedBuffer = new ArrayBuffer(MAX_NUTRITION_IMAGE_BYTES + 1);
    const oversizedFile = new File([oversizedBuffer], 'huge-meal.jpg', {
      type: 'image/jpeg',
    });
    formData.append('image', oversizedFile);

    const res = await app.request('/api/nutrition/parse', {
      method: 'POST',
      headers: makeAuthHeaders(),
      body: formData,
    });
    expect(res.status).toBe(413);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('FILE_TOO_LARGE');
    expect(parserCalled).toBe(false);
  });

  it('POST /api/nutrition/parse returns 400 UNSUPPORTED_MEDIA_TYPE for non-image files (application/pdf)', async () => {
    let parserCalled = false;
    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
      parseNutrition: async () => {
        parserCalled = true;
        return { suggested_meal_type: 'snack', items: [] };
      },
    });

    const formData = new FormData();
    const pdfFile = new File(['%PDF-1.4 fake document'], 'nutrition.pdf', {
      type: 'application/pdf',
    });
    formData.append('image', pdfFile);

    const res = await app.request('/api/nutrition/parse', {
      method: 'POST',
      headers: makeAuthHeaders(),
      body: formData,
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(parserCalled).toBe(false);
  });

  it('POST /api/nutrition/parse returns 200 with items and suggested_meal_type for valid image/jpeg + Thai text', async () => {
    const receivedInputs: ParseNutritionInput[] = [];
    const expectedResponse: ParseNutritionResponse = {
      suggested_meal_type: 'dinner',
      items: [
        {
          food_name: 'ข้าวสวย',
          portion_desc: '200 กรัม',
          calories: 260,
          protein_g: 5.2,
          carbs_g: 56.2,
          fat_g: 0.4,
          confidence: 'HIGH',
        },
        {
          food_name: 'อกไก่ย่าง',
          portion_desc: '1 ชิ้น (150 กรัม)',
          calories: 248,
          protein_g: 46.5,
          carbs_g: 0,
          fat_g: 5.4,
          confidence: 'HIGH',
        },
      ],
    };

    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
      parseNutrition: async (input) => {
        receivedInputs.push(input);
        return expectedResponse;
      },
    });

    const rawBytes = 'fake-jpeg-binary-content';
    const formData = new FormData();
    formData.append('text', '  ข้าวสวย 200g อกไก่ย่าง 1 ชิ้น  ');
    formData.append(
      'image',
      new File([rawBytes], 'dinner.jpg', { type: 'image/jpeg' }),
    );

    const res = await app.request('/api/nutrition/parse', {
      method: 'POST',
      headers: makeAuthHeaders(),
      body: formData,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as ParseNutritionResponse;
    expect(ParseNutritionResponseSchema.safeParse(body).success).toBe(true);
    expect(body.suggested_meal_type).toBe('dinner');
    expect(body.items).toHaveLength(2);
    expect(body.items[0].food_name).toBe('ข้าวสวย');
    expect(body.items[1].food_name).toBe('อกไก่ย่าง');

    expect(receivedInputs).toHaveLength(1);
    expect(receivedInputs[0].text).toBe('ข้าวสวย 200g อกไก่ย่าง 1 ชิ้น');
    expect(receivedInputs[0].image).toEqual({
      base64: Buffer.from(rawBytes).toString('base64'),
      mimeType: 'image/jpeg',
    });
  });

  it('POST /api/nutrition/batch with source AI_IMAGE persists multiple items and updates GET /api/dashboard/today', async () => {
    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
    });
    const authHeaders = makeAuthHeaders();

    const beforeRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    expect(beforeRes.status).toBe(200);
    const before = (await beforeRes.json()) as DashboardTodayResponse;

    const batchPayload = {
      source: 'AI_IMAGE' as const,
      items: [
        {
          itemName: 'ข้าวสวย',
          portionDesc: '200 กรัม',
          mealType: 'dinner' as const,
          calories: 260,
          proteinG: 5.2,
          carbsG: 56.2,
          fatG: 0.4,
        },
        {
          itemName: 'อกไก่ย่าง',
          portionDesc: '150 กรัม',
          mealType: 'dinner' as const,
          calories: 248,
          proteinG: 46.5,
          carbsG: 0,
          fatG: 5.4,
        },
        {
          itemName: 'ไข่ต้ม',
          portionDesc: '2 ฟอง',
          mealType: 'dinner' as const,
          calories: 144,
          proteinG: 12.6,
          carbsG: 1.2,
          fatG: 10.0,
        },
      ],
    };

    const batchRes = await app.request('/api/nutrition/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(batchPayload),
    });
    expect(batchRes.status).toBe(201);

    const batchBody = (await batchRes.json()) as {
      items: NutritionLogDTO[];
      count: number;
      source: string;
    };
    expect(batchBody.count).toBe(3);
    expect(batchBody.source).toBe('AI_IMAGE');
    expect(batchBody.items).toHaveLength(3);
    for (const item of batchBody.items) {
      expect(item.source).toBe('AI_IMAGE');
    }

    const addedCalories = 260 + 248 + 144;
    const addedProtein = 5.2 + 46.5 + 12.6;
    const addedCarbs = 56.2 + 0 + 1.2;
    const addedFat = 0.4 + 5.4 + 10.0;

    const afterRes = await app.request('/api/dashboard/today', {
      headers: authHeaders,
    });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as DashboardTodayResponse;

    expect(after.energy.consumedCalories).toBe(
      before.energy.consumedCalories + addedCalories,
    );
    expect(after.macros.protein.consumed).toBeCloseTo(
      before.macros.protein.consumed + addedProtein,
      1,
    );
    expect(after.macros.carbs.consumed).toBeCloseTo(
      before.macros.carbs.consumed + addedCarbs,
      1,
    );
    expect(after.macros.fat.consumed).toBeCloseTo(
      before.macros.fat.consumed + addedFat,
      1,
    );

    expect(after.meals).toHaveLength(before.meals.length + 3);
    for (const createdItem of batchBody.items) {
      const persisted = after.meals.find((m) => m.id === createdItem.id);
      expect(persisted).toBeDefined();
      expect(persisted!.source).toBe('AI_IMAGE');
      expect(persisted!.itemName).toBe(createdItem.itemName);
    }
  });

  it('POST /api/nutrition/batch returns 400 when items array is empty', async () => {
    const app = createApp(new InMemoryHealthRepository(), {
      jwtSecret: TEST_JWT_SECRET,
    });

    const res = await app.request('/api/nutrition/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...makeAuthHeaders() },
      body: JSON.stringify({
        source: 'AI_TEXT',
        items: [],
      }),
    });
    expect(res.status).toBe(400);
  });
});
