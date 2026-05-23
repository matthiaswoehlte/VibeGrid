import 'server-only';
import { betterAuth } from 'better-auth';
import { pool } from '@/lib/db/pg';

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is not set');
}
if (!process.env.NEXT_PUBLIC_BASE_URL) {
  throw new Error('NEXT_PUBLIC_BASE_URL is not set');
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_BASE_URL,
  emailAndPassword: { enabled: true, autoSignIn: false },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24 // refresh once a day
  },
  trustedOrigins: [process.env.NEXT_PUBLIC_BASE_URL],
  advanced: {
    cookiePrefix: 'vibegrid',
    useSecureCookies: process.env.NODE_ENV === 'production'
  }
});

export type Session = typeof auth.$Infer.Session;
