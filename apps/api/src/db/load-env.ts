import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

function getCandidateEnvPaths(): string[] {
  const candidates: string[] = [];

  try {
    if (typeof import.meta?.url === 'string' && import.meta.url.startsWith('file:')) {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      candidates.push(
        path.resolve(dir, '../../.env'),
        path.resolve(dir, '../../../.env'),
      );
    }
  } catch {
    // Ignore when bundled into CJS by tools like drizzle-kit
  }

  const cwd = process.cwd();
  candidates.push(
    path.resolve(cwd, '.env'),
    path.resolve(cwd, '../.env'),
    path.resolve(cwd, '../../.env'),
  );

  return Array.from(new Set(candidates));
}

/**
 * Loads environment variables from `apps/api/.env` and the monorepo root `.env`
 * without overriding variables already present in `process.env`.
 */
export function loadRootEnv(): void {
  if (loaded) {
    return;
  }
  loaded = true;

  for (const envPath of getCandidateEnvPaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eqIndex = line.indexOf('=');
      if (eqIndex <= 0) {
        continue;
      }

      const key = line.slice(0, eqIndex).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        continue;
      }

      let value = line.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
