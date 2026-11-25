import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';

const dateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export function createDashboardRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.get('/today', async (c) => {
    const rawDate = c.req.query('date');
    if (rawDate !== undefined) {
      const parsed = dateQuerySchema.safeParse(rawDate);
      if (!parsed.success) {
        return c.json(
          {
            error: 'Validation failed',
            details: parsed.error.flatten(),
          },
          400,
        );
      }
    }

    const data = await resolveRepo().getTodayData(c.get('userId'), rawDate);
    return c.json(data, 200);
  });

  return router;
}
