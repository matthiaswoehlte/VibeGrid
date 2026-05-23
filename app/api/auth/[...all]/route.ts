import { auth } from '@/lib/auth/better-auth-server';
import { toNextJsHandler } from 'better-auth/next-js';

export const runtime = 'nodejs';

export const { POST, GET } = toNextJsHandler(auth);
