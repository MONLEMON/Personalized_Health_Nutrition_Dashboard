import { Hono, type MiddlewareHandler } from 'hono';
import { AddWaterLogSchema, HydrationQuerySchema } from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import { validateJsonBody } from './validation';

/**
 * Creates authenticated daily hydration tracking routes (`/today`, `/`, `/:id`).
 */
export function createHydrationRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.get('/today', async (c) => {
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

    const summary = await resolveRepo().getHydrationSummary(
      c.get('userId'),
      parsed.data.date,
    );
    return c.json(summary, 200);
  });

  router.post('/', async (c) => {
    const validated = await validateJsonBody(c, AddWaterLogSchema);
    if (!validated.ok) return validated.response;

    const summary = await resolveRepo().addWaterLog(
      c.get('userId'),
      validated.data,
    );
    return c.json(summary, 201);
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const summary = await resolveRepo().deleteWaterLog(c.get('userId'), id);
    if (!summary) {
      return c.json({ error: 'Hydration entry not found' }, 404);
    }
    return c.json(summary, 200);
  });

  return router;
}
