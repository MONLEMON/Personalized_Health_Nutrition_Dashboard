import { Hono, type MiddlewareHandler } from 'hono';
import { createBodyMetricSchema, trendsQuerySchema } from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import { validateJsonBody } from './validation';

export function createMetricsRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.get('/trends', async (c) => {
    const rawDays = c.req.query('days');
    const parsed = trendsQuerySchema.safeParse(
      rawDays === undefined ? {} : { days: rawDays },
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

    const trends = await resolveRepo().getTrends(c.get('userId'), parsed.data.days);
    return c.json(trends, 200);
  });

  router.post('/', async (c) => {
    const validated = await validateJsonBody(c, createBodyMetricSchema);
    if (!validated.ok) return validated.response;

    const created = await resolveRepo().createBodyMetric(
      c.get('userId'),
      validated.data,
    );
    return c.json(created, 201);
  });

  return router;
}
