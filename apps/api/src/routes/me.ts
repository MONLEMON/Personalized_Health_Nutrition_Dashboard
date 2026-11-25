import { Hono, type MiddlewareHandler } from 'hono';
import { OnboardingProfileSchema } from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';

/**
 * Creates authenticated account, onboarding, and personal webhook-key settings routes.
 */
export function createMeRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  authMiddleware: MiddlewareHandler<AuthAppEnv> = createAuthMiddleware(),
) {
  const router = new Hono<AuthAppEnv>();

  router.use('/me', authMiddleware);
  router.use('/onboarding', authMiddleware);
  router.use('/settings/*', authMiddleware);

  router.get('/me', async (c) => {
    const userId = c.get('userId');
    const userEmail = c.get('userEmail') ?? null;
    const me = await resolveRepo().getMe(userId, userEmail);
    return c.json(me, 200);
  });

  router.post('/onboarding', async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400);
    }

    const parsed = OnboardingProfileSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    const userId = c.get('userId');
    const userEmail = c.get('userEmail') ?? null;
    const fallbackName =
      c.get('userName') ?? (userEmail ? userEmail.split('@')[0] : undefined);

    const me = await resolveRepo().completeOnboarding(
      userId,
      parsed.data,
      fallbackName,
      userEmail,
    );
    return c.json(me, 201);
  });

  router.post('/settings/webhook-key', async (c) => {
    const userId = c.get('userId');
    const key = await resolveRepo().generateWebhookKey(userId);
    return c.json(key, 201);
  });

  return router;
}
