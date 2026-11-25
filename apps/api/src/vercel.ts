import { handle } from 'hono/vercel';
import app from './app';

export const config = {
  maxDuration: 30,
};

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;

export default handler;
