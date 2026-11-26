import { Hono, type MiddlewareHandler } from 'hono';
import {
  ApplyWeeklyCoachSchema,
  GenerateWeeklyCoachSchema,
  WeeklyCoachQuerySchema,
} from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import {
  generateWeeklyCoachNarrative,
  type WeeklyCoachNarrativeFn,
} from '../services/weeklyCoach.service';
import { validateJsonBody } from './validation';

/**
 * Creates authenticated Weekly AI Nutrition Coach routes (`GET /weekly`,
 * `POST /weekly/generate`, `POST /weekly/apply`).
 */
export function createCoachRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
  generateNarrative: WeeklyCoachNarrativeFn = generateWeeklyCoachNarrative,
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.get('/weekly', async (c) => {
    const rawWeekStart = c.req.query('weekStart');
    const parsed = WeeklyCoachQuerySchema.safeParse(
      rawWeekStart === undefined ? {} : { weekStart: rawWeekStart },
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

    const status = await resolveRepo().getWeeklyCoachStatus(
      c.get('userId'),
      parsed.data.weekStart,
    );
    return c.json(status, 200);
  });

  router.post('/weekly/generate', async (c) => {
    const rawText = await c.req.text();
    let rawBody: unknown = {};
    if (rawText.trim() !== '') {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        return c.json({ error: 'Invalid JSON request body' }, 400);
      }
    }

    const parsed = GenerateWeeklyCoachSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const report = await resolveRepo().generateWeeklyCoachReport(c.get('userId'), {
      weekStart: parsed.data.weekStart,
      force: parsed.data.force,
      generateNarrative,
    });
    return c.json(report, 200);
  });

  router.post('/weekly/apply', async (c) => {
    const validated = await validateJsonBody(c, ApplyWeeklyCoachSchema);
    if (!validated.ok) return validated.response;

    const result = await resolveRepo().applyWeeklyCoachRecommendation(
      c.get('userId'),
      validated.data.reportId,
      c.get('userEmail') ?? null,
    );
    return c.json(result, 200);
  });

  return router;
}
