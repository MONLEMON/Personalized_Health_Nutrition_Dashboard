import { Hono, type MiddlewareHandler } from 'hono';
import { createWorkoutLogSchema } from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import { validateJsonBody } from './validation';

export function createWorkoutRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();
  router.use('*', authMiddleware);

  router.post('/', async (c) => {
    const validated = await validateJsonBody(c, createWorkoutLogSchema);
    if (!validated.ok) return validated.response;

    const created = await resolveRepo().createWorkoutLog(
      c.get('userId'),
      validated.data,
    );
    return c.json(created, 201);
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await resolveRepo().deleteWorkoutLog(c.get('userId'), id);
    if (!deleted) {
      return c.json({ error: 'Workout log not found' }, 404);
    }
    return c.json({ deleted: true, id }, 200);
  });

  return router;
}
