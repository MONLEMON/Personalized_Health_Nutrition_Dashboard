import type { Context } from 'hono';
import type { ZodSchema } from 'zod';

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/**
 * Parses JSON request body and validates it against a Zod schema,
 * returning a 400 JSON error response on malformed JSON or schema mismatch.
 */
export async function validateJsonBody<T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<ValidationResult<T>> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'Invalid JSON request body' }, 400),
    };
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten(),
        },
        400,
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
