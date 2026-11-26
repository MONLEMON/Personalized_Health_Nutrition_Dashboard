import { Hono, type MiddlewareHandler } from 'hono';
import { calendarQuerySchema, trendsQuerySchema } from '@health-dash/shared';
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

  router.get('/bootstrap', async (c) => {
    const rawDays = c.req.query('days');
    const parsedDays = trendsQuerySchema.safeParse(
      rawDays === undefined ? {} : { days: rawDays },
    );
    if (!parsedDays.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsedDays.error.flatten(),
        },
        400,
      );
    }

    const rawDate = c.req.query('date');
    if (rawDate !== undefined) {
      const parsedDate = dateQuerySchema.safeParse(rawDate);
      if (!parsedDate.success) {
        return c.json(
          {
            error: 'Validation failed',
            details: parsedDate.error.flatten(),
          },
          400,
        );
      }
    }

    const data = await resolveRepo().getBootstrapData(
      c.get('userId'),
      parsedDays.data.days,
      c.get('userEmail') ?? null,
      rawDate,
    );
    return c.json(data, 200);
  });

  router.get('/calendar', async (c) => {
    const rawMonth = c.req.query('month');
    const parsed = calendarQuerySchema.safeParse(
      rawMonth === undefined ? {} : { month: rawMonth },
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

    const data = await resolveRepo().getMonthlyCalendar(
      c.get('userId'),
      parsed.data.month,
    );
    return c.json(data, 200);
  });

  return router;
}
