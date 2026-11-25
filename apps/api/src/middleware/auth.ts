import crypto from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { loadRootEnv } from '../db/load-env';

export type AuthVariables = {
  userId: string;
  userEmail?: string;
  userName?: string;
};

export type AuthAppEnv = {
  Variables: AuthVariables;
};

export type VerifiedTokenUser = {
  userId: string;
  email?: string;
  name?: string;
};

export type TokenVerifierFn = (token: string) => Promise<VerifiedTokenUser | null>;

export interface AuthMiddlewareOptions {
  jwtSecret?: string;
  verifyToken?: TokenVerifierFn;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  if (!segment || !BASE64URL_RE.test(segment)) {
    return null;
  }
  try {
    const jsonText = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractVerifiedUser(
  userId: string,
  claims: Record<string, unknown>,
): VerifiedTokenUser {
  const email = nonEmptyString(claims.email);
  const metadata =
    typeof claims.user_metadata === 'object' && claims.user_metadata !== null
      ? (claims.user_metadata as Record<string, unknown>)
      : null;
  const name =
    nonEmptyString(claims.name) ??
    nonEmptyString(metadata?.full_name) ??
    nonEmptyString(metadata?.name);

  return {
    userId,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
  };
}

/**
 * Signs a compact HS256 JWT using Node crypto HMAC-SHA256 + base64url encoding.
 */
export function signHs256Jwt(
  payload: { sub: string; email?: string; name?: string; exp?: number },
  secret: string,
): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');

  const payloadObj: Record<string, unknown> = { sub: payload.sub };
  if (payload.email !== undefined) {
    payloadObj.email = payload.email;
  }
  if (payload.name !== undefined) {
    payloadObj.name = payload.name;
  }
  if (payload.exp !== undefined) {
    payloadObj.exp = payload.exp;
  }

  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString(
    'base64url',
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(signingInput, 'utf8')
    .digest('base64url');

  return `${signingInput}.${signatureB64}`;
}

/**
 * Verifies an HS256 JWT signature (timing-safe), non-empty `sub`, and `exp` timestamp.
 */
export function verifyHs256Jwt(
  token: string,
  secret: string,
): VerifiedTokenUser | null {
  if (!token || !secret) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64 || !BASE64URL_RE.test(signatureB64)) {
    return null;
  }

  const header = decodeBase64UrlJson(headerB64);
  if (!header || header.alg !== 'HS256') {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`, 'utf8')
    .digest();
  const providedSig = Buffer.from(signatureB64, 'base64url');

  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    return null;
  }

  const payload = decodeBase64UrlJson(payloadB64);
  if (!payload) {
    return null;
  }

  const sub = nonEmptyString(payload.sub);
  if (!sub) {
    return null;
  }

  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
  }

  return extractVerifiedUser(sub, payload);
}

async function verifyWithSupabaseApi(
  token: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<VerifiedTokenUser | null> {
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return null;
    }

    const userId = nonEmptyString(data.id);
    if (!userId) {
      return null;
    }

    return extractVerifiedUser(userId, data);
  } catch {
    return null;
  }
}

/**
 * Middleware verifying Supabase Bearer JWTs and populating `userId`, `userEmail`, and `userName`.
 */
export function createAuthMiddleware(options?: AuthMiddlewareOptions) {
  return createMiddleware<AuthAppEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const match = authHeader?.match(/^\s*Bearer\s+(\S+)\s*$/i);
    const token = match?.[1]?.trim() ?? '';

    if (!token) {
      return c.json({ error: 'Unauthorized: missing Bearer token' }, 401);
    }

    let verified: VerifiedTokenUser | null = null;

    if (options?.verifyToken) {
      verified = await options.verifyToken(token);
    } else {
      loadRootEnv();
      const parts = token.split('.');
      const header = parts.length === 3 ? decodeBase64UrlJson(parts[0]) : null;
      const secret =
        (options?.jwtSecret ?? process.env.SUPABASE_JWT_SECRET)?.trim() ?? '';

      if (secret && header?.alg === 'HS256') {
        verified = verifyHs256Jwt(token, secret);
      } else if (options?.jwtSecret === undefined) {
        const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? '';
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? '';
        if (supabaseUrl && supabaseAnonKey) {
          verified = await verifyWithSupabaseApi(token, supabaseUrl, supabaseAnonKey);
        }
      }
    }

    if (!verified) {
      return c.json({ error: 'Unauthorized: invalid or expired token' }, 401);
    }

    c.set('userId', verified.userId);
    c.set('userEmail', verified.email);
    c.set('userName', verified.name);
    await next();
  });
}
