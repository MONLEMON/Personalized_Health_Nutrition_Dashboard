import { Hono, type MiddlewareHandler } from 'hono';
import {
  OnboardingProfileSchema,
  UpdateProfileSettingsSchema,
  UpdateSupplementsSchema,
} from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import { validateJsonBody } from './validation';

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

  router.put('/settings/supplements', async (c) => {
    const validated = await validateJsonBody(c, UpdateSupplementsSchema);
    if (!validated.ok) return validated.response;

    const supplementStack = await resolveRepo().updateSupplementStack(
      c.get('userId'),
      validated.data.supplements,
    );
    return c.json({ supplementStack }, 200);
  });

  router.patch('/settings/profile', async (c) => {
    const validated = await validateJsonBody(c, UpdateProfileSettingsSchema);
    if (!validated.ok) return validated.response;

    const me = await resolveRepo().updateProfileSettings(
      c.get('userId'),
      validated.data,
      c.get('userEmail') ?? null,
    );
    return c.json(me, 200);
  });

  return router;
}
