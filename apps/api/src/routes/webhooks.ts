import { Hono, type MiddlewareHandler } from 'hono';
import { AppleHealthWebhookPayloadSchema } from '@health-dash/shared';
import { getRepository, type HealthRepository } from '../db/repository';
import { createAuthMiddleware, type AuthAppEnv } from '../middleware/auth';
import {
  createPerUserWebhookAuthMiddleware,
  type WebhookAppEnv,
} from '../middleware/webhookAuth';

export interface CreateWebhookRoutesOptions {
  authMiddleware?: MiddlewareHandler<AuthAppEnv>;
}

/**
 * Creates Hono routes for Apple Health webhook sync (`POST /apple-health` via per-user X-API-Key)
 * and sync status inspection (`GET /status` via authenticated JWT).
 */
export function createWebhookRoutes(
  resolveRepo: () => HealthRepository = getRepository,
  options?: CreateWebhookRoutesOptions,
) {
  const router = new Hono<AuthAppEnv & WebhookAppEnv>();
  const authMiddleware = options?.authMiddleware ?? createAuthMiddleware();

  router.post(
    '/apple-health',
    createPerUserWebhookAuthMiddleware(resolveRepo),
    async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON request body' }, 400);
      }

      const parsed = AppleHealthWebhookPayloadSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(
          {
            error: 'Validation failed',
            details: parsed.error.flatten(),
          },
          400,
        );
      }

      const result = await resolveRepo().syncAppleHealth(
        c.get('webhookUserId'),
        parsed.data,
      );
      return c.json(result, 200);
    },
  );

  router.get('/status', authMiddleware, async (c) => {
    const status = await resolveRepo().getAppleHealthSyncStatus(c.get('userId'));
    return c.json(status, 200);
  });

  return router;
}
