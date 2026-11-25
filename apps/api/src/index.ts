import { loadRootEnv } from './db/load-env';

loadRootEnv();

import app from './app';
import { getRepository } from './db/repository';

const port = Number(process.env.PORT ?? 3001);
const storageMode = getRepository().getStorageMode();

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(
  `VitalPulse API listening on http://localhost:${server.port} (storage: ${storageMode})`,
);
