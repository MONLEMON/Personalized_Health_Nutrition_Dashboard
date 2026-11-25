import { Hono, type MiddlewareHandler } from 'hono';
import {
  CreateBatchNutritionLogsSchema,
  createNutritionLogSchema,
  toggleSupplementSchema,
  type CreateBatchNutritionLogsInput,
} from '@health-dash/shared';
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

  router.post('/', async (c) => {
    const validated = await validateJsonBody(c, createNutritionLogSchema);
    if (!validated.ok) return validated.response;

    const created = await resolveRepo().createNutritionLog(
      c.get('userId'),
      validated.data,
    );
    return c.json(created, 201);
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
