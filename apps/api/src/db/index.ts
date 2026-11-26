import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { loadRootEnv } from './load-env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

let cachedUrl: string | undefined;
let cachedClient: Sql | null = null;
let cachedDb: Database | null = null;

function shouldRequireSsl(connectionUrl: string): boolean {
  try {
    const parsed = new URL(connectionUrl);
    if (parsed.searchParams.has('sslmode')) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return false;
  }
}

/**
 * Returns a Drizzle PostgreSQL instance when DATABASE_URL is configured,
 * or null when running in zero-config in-memory mode.
 */
export function getDb(): Database | null {
  loadRootEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return null;
  }

  if (cachedDb && cachedUrl === url) {
    return cachedDb;
  }

  cachedUrl = url;
  cachedClient = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 10,
    max_lifetime: 300,
    connect_timeout: 10,
    ...(shouldRequireSsl(url) ? { ssl: 'require' } : {}),
  });
  cachedDb = drizzle(cachedClient, { schema });
  return cachedDb;
}

/**
 * Closes any active PostgreSQL connection pool (used by CLI scripts).
 */
export async function closeDb(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end();
    cachedClient = null;
    cachedDb = null;
    cachedUrl = undefined;
  }
}
