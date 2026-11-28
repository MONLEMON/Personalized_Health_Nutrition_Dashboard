import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  CopyYesterdayMealsSchema,
  CreateBatchNutritionLogsSchema,
  CreateSavedMealSchema,
  HydrationQuerySchema,
  LogSavedMealSchema,
  createNutritionLogSchema,
  toggleSupplementSchema,
  updateNutritionLogSchema,
  type CreateBatchNutritionLogsInput,
} from '@health-dash/shared';
import { z, type ZodTypeDef } from 'zod';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import {
  AiNutritionError,
  MAX_NUTRITION_IMAGE_BYTES,
  parseNutritionWithGemini,
  type NutritionParserFn,
  type ParseNutritionInput,
} from '../services/aiNutrition';
import { validateJsonBody } from './validation';

async function validateOptionalJsonBody<T>(
  c: Context,
  schema: z.ZodType<T, ZodTypeDef, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const rawText = await c.req.text();
  let rawBody: unknown = {};
  if (rawText.trim() !== '') {
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return {
        ok: false,
        response: c.json({ error: 'Invalid JSON request body' }, 400),
      };
    }
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400,
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

export function createNutritionRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  parseNutrition: NutritionParserFn = parseNutritionWithGemini,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.post('/parse', async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json(
        {
          error: 'Request body must be valid multipart/form-data.',
          code: 'INVALID_INPUT',
        },
        400,
      );
    }

    const rawText = formData.get('text');
    const trimmedText = typeof rawText === 'string' ? rawText.trim() : '';
    const text = trimmedText.length > 0 ? trimmedText : undefined;

    const rawImage = formData.get('image');
    const imageFile =
      rawImage instanceof File && rawImage.size > 0 ? rawImage : undefined;

    if (!text && !imageFile) {
      return c.json(
        {
          error: 'Provide a meal description or food photo to analyze.',
          code: 'INVALID_INPUT',
        },
        400,
      );
    }

    let imageInput: ParseNutritionInput['image'];
    if (imageFile) {
      if (!imageFile.type.startsWith('image/')) {
        return c.json(
          {
            error: 'Unsupported file type. Please upload an image.',
            code: 'UNSUPPORTED_MEDIA_TYPE',
          },
          400,
        );
      }

      if (imageFile.size > MAX_NUTRITION_IMAGE_BYTES) {
        return c.json(
          {
            error: 'Image exceeds the 5MB maximum upload size.',
            code: 'FILE_TOO_LARGE',
          },
          413,
        );
      }

      const base64 = Buffer.from(await imageFile.arrayBuffer()).toString('base64');
      imageInput = {
        base64,
        mimeType: imageFile.type,
      };
    }

    try {
      const result = await parseNutrition({
        ...(text ? { text } : {}),
        ...(imageInput ? { image: imageInput } : {}),
      });
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof AiNutritionError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode);
      }
      throw err;
    }
  });

  router.post('/batch', async (c) => {
    const validated = await validateJsonBody(c, CreateBatchNutritionLogsSchema);
    if (!validated.ok) return validated.response;

    const batchInput: CreateBatchNutritionLogsInput = {
      ...validated.data,
      source: validated.data.source ?? 'AI_TEXT',
    };

    const created = await resolveRepo().createNutritionLogsBatch(
      c.get('userId'),
      batchInput,
    );
    return c.json(
      {
        items: created,
        count: created.length,
        source: batchInput.source,
      },
      201,
    );
  });

  router.get('/saved', async (c) => {
    const rawDate = c.req.query('date');
    const parsed = HydrationQuerySchema.safeParse(
      rawDate === undefined ? {} : { date: rawDate },
    );
    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const result = await resolveRepo().listSavedAndRecentMeals(
      c.get('userId'),
      parsed.data.date,
    );
    return c.json(result, 200);
  });

  router.post('/saved', async (c) => {
    const validated = await validateJsonBody(c, CreateSavedMealSchema);
    if (!validated.ok) return validated.response;

    const created = await resolveRepo().createSavedMeal(
      c.get('userId'),
      validated.data,
    );
    return c.json(created, 201);
  });

  router.delete('/saved/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await resolveRepo().deleteSavedMeal(c.get('userId'), id);
    if (!deleted) {
      return c.json({ error: 'Saved meal not found' }, 404);
    }
    return c.json({ deleted: true, id }, 200);
  });

  router.post('/saved/:id/log', async (c) => {
    const validated = await validateOptionalJsonBody(c, LogSavedMealSchema);
    if (!validated.ok) return validated.response;

    const id = c.req.param('id');
    const logged = await resolveRepo().logSavedMeal(
      c.get('userId'),
      id,
      validated.data,
    );
    if (!logged) {
      return c.json({ error: 'Saved meal not found' }, 404);
    }
    return c.json(logged, 201);
  });

  router.post('/copy-yesterday', async (c) => {
    const validated = await validateOptionalJsonBody(c, CopyYesterdayMealsSchema);
    if (!validated.ok) return validated.response;

    const result = await resolveRepo().copyYesterdayMeals(
      c.get('userId'),
      validated.data,
    );
    return c.json(result, result.copiedCount > 0 ? 201 : 200);
  });

  router.post('/', async (c) => {
    const validated = await validateJsonBody(c, createNutritionLogSchema);
    if (!validated.ok) return validated.response;

    const created = await resolveRepo().createNutritionLog(
      c.get('userId'),
      validated.data,
    );
    return c.json(created, 201);
  });

  router.patch('/:id', async (c) => {
    const validated = await validateJsonBody(c, updateNutritionLogSchema);
    if (!validated.ok) return validated.response;

    const id = c.req.param('id');
    const updated = await resolveRepo().updateNutritionLog(
      c.get('userId'),
      id,
      validated.data,
    );
    if (!updated) {
      return c.json({ error: 'Nutrition log not found' }, 404);
    }
    return c.json(updated, 200);
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await resolveRepo().deleteNutritionLog(c.get('userId'), id);
    if (!deleted) {
      return c.json({ error: 'Nutrition log not found' }, 404);
    }
    return c.json({ deleted: true, id }, 200);
  });

  return router;
}

export function createSupplementRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.post('/toggle', async (c) => {
    const validated = await validateJsonBody(c, toggleSupplementSchema);
    if (!validated.ok) return validated.response;

    const result = await resolveRepo().toggleSupplement(
      c.get('userId'),
      validated.data,
    );
    return c.json(result, 200);
  });

  return router;
}
