import 'server-only';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicUrl: string;
}

let cached: R2Config | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/**
 * Lazy. Throws on first call if any required var is missing. Intentionally NOT
 * cached across module reloads in tests — call _resetR2ConfigForTests().
 */
export function getR2Config(): R2Config {
  if (cached) return cached;
  cached = {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
    endpoint: requireEnv('R2_ENDPOINT'),
    publicUrl: requireEnv('R2_PUBLIC_URL')
  };
  return cached;
}

/** For tests only. */
export function _resetR2ConfigForTests(): void {
  cached = null;
}
