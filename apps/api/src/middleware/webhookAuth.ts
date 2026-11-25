import crypto from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { HealthRepository } from '../db/repository';

export type WebhookAppEnv = {
  Variables: {
    webhookUserId: string;
  };
};

/**
 * Computes the SHA-256 hex digest of a raw webhook API key.
 */
export function hashWebhookApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Middleware validating the `X-API-Key` header against per-user hashed webhook keys
 * stored on `user_profiles`, attaching `webhookUserId` to the Hono context.
 */
export function createPerUserWebhookAuthMiddleware(
  resolveRepo: () => HealthRepository,
) {
  return createMiddleware<WebhookAppEnv>(async (c, next) => {
    const providedKey = c.req.header('X-API-Key')?.trim() ?? '';
    if (!providedKey) {
      return c.json({ error: 'Unauthorized: missing X-API-Key' }, 401);
    }

    const keyHash = hashWebhookApiKey(providedKey);
    const userId = await resolveRepo().findUserIdByWebhookKeyHash(keyHash);
    if (!userId) {
      return c.json({ error: 'Unauthorized: invalid X-API-Key' }, 401);
    }

    c.set('webhookUserId', userId);
    await next();
  });
}
