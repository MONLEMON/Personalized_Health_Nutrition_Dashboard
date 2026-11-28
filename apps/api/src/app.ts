import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { getRepository, type HealthRepository } from './db/repository';
import { createAuthMiddleware, type TokenVerifierFn } from './middleware/auth';
import { createCoachRoutes } from './routes/coach';
import { createDashboardRoutes } from './routes/dashboard';
import { createHydrationRoutes } from './routes/hydration';
import { createMeRoutes } from './routes/me';
import { createMetricsRoutes } from './routes/metrics';
import { createNutritionRoutes, createSupplementRoutes } from './routes/nutrition';
import { createWebhookRoutes } from './routes/webhooks';
import { createWorkoutRoutes } from './routes/workouts';
import type { NutritionParserFn } from './services/aiNutrition';
import type { WeeklyCoachNarrativeFn } from './services/weeklyCoach.service';

export interface CreateAppOptions {
  parseNutrition?: NutritionParserFn;
  generateWeeklyCoachNarrative?: WeeklyCoachNarrativeFn;
  jwtSecret?: string;
  verifyToken?: TokenVerifierFn;
  /** @deprecated Per-user webhook keys stored on user_profiles are now used instead. */
  webhookApiKey?: string;
}

/**
 * Creates the configured Hono application with CORS, JWT authentication,
 * validation, and JSON error handling.
 */
export function createApp(
  repository?: HealthRepository,
  options?: CreateAppOptions,
): Hono {
  const app = new Hono();
  const resolveRepo = () => repository ?? getRepository();
  const authMiddleware = createAuthMiddleware({
    jwtSecret: options?.jwtSecret,
    verifyToken: options?.verifyToken,
  });

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    }),
  );

  app.get('/api/health', (c) => {
    return c.json(
      {
        status: 'ok',
        storageMode: resolveRepo().getStorageMode(),
        timestamp: new Date().toISOString(),
      },
      200,
    );
  });

  app.route('/api', createMeRoutes(resolveRepo, authMiddleware));
  app.route('/api/dashboard', createDashboardRoutes(resolveRepo, authMiddleware));
  app.route('/api/metrics', createMetricsRoutes(resolveRepo, authMiddleware));
  app.route(
    '/api/nutrition',
    createNutritionRoutes(resolveRepo, options?.parseNutrition, authMiddleware),
  );
  app.route('/api/supplements', createSupplementRoutes(resolveRepo, authMiddleware));
  app.route('/api/hydration', createHydrationRoutes(resolveRepo, authMiddleware));
  app.route('/api/workouts', createWorkoutRoutes(resolveRepo, authMiddleware));
  app.route('/api/webhooks', createWebhookRoutes(resolveRepo, { authMiddleware }));
  app.route(
    '/api/coach',
    createCoachRoutes(resolveRepo, authMiddleware, options?.generateWeeklyCoachNarrative),
  );

  app.notFound((c) => c.json({ error: 'Not Found' }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return c.json({ error: message }, 500);
  });

  return app;
}

export const app = createApp();
export default app;
