// Check the status of a fal.queue job directly.
// Usage: node scripts/check-fal-job.mjs <endpoint> <request_id>

import { readFileSync } from 'node:fs';
import { fal } from '@fal-ai/client';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(?:"(.*)"|(.*))$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2] ?? m[3] ?? '';
  }
} catch {}

if (!process.env.FAL_KEY) {
  console.error('FAL_KEY not set');
  process.exit(1);
}
fal.config({ credentials: process.env.FAL_KEY });

const endpoint = process.argv[2];
const requestId = process.argv[3];
if (!endpoint || !requestId) {
  console.error('Usage: node scripts/check-fal-job.mjs <endpoint> <request_id>');
  process.exit(1);
}

console.log(`Checking ${endpoint} requestId=${requestId}…`);
try {
  const status = await fal.queue.status(endpoint, { requestId, logs: true });
  console.log('\nStatus payload:');
  console.log(JSON.stringify(status, null, 2));
  if (status.status === 'COMPLETED') {
    console.log('\nFetching result…');
    const result = await fal.queue.result(endpoint, { requestId });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (e) {
  console.error('FAIL:', e.message);
  if (e.body) console.error('Body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
}
