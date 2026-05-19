// Diagnoses R2 TLS connectivity without printing any secrets.
// Reads .env.local manually (Node doesn't auto-load it outside Next.js).
import { readFileSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const endpoint = env.R2_ENDPOINT || '';
const accountId = env.R2_ACCOUNT_ID || '';

// Extract host from URL without printing the full URL
const m = endpoint.match(/^https?:\/\/([^/]+)/);
const host = m ? m[1] : '';

// Mask account id in any printed host: show first 4 + last 4 chars only
function mask(s) {
  if (!s || s.length < 12) return '<short>';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

console.log('--- env shape ---');
console.log('R2_ACCOUNT_ID present:', Boolean(env.R2_ACCOUNT_ID), '| length:', accountId.length, '| masked:', mask(accountId));
console.log('R2_ACCESS_KEY_ID present:', Boolean(env.R2_ACCESS_KEY_ID), '| length:', (env.R2_ACCESS_KEY_ID || '').length);
console.log('R2_SECRET_ACCESS_KEY present:', Boolean(env.R2_SECRET_ACCESS_KEY), '| length:', (env.R2_SECRET_ACCESS_KEY || '').length);
console.log('R2_BUCKET:', env.R2_BUCKET || '<missing>');
console.log('R2_ENDPOINT host:', host ? mask(host.split('.')[0]) + '.' + host.split('.').slice(1).join('.') : '<missing>');
console.log('R2_PUBLIC_URL present:', Boolean(env.R2_PUBLIC_URL));

// Sanity: does the endpoint hostname start with R2_ACCOUNT_ID?
if (host && accountId) {
  const startsWithAccount = host.toLowerCase().startsWith(accountId.toLowerCase());
  console.log('endpoint host starts with R2_ACCOUNT_ID:', startsWithAccount);
  if (!startsWithAccount) {
    console.log('  ↑ MISMATCH: R2 endpoints look like <account-id>.r2.cloudflarestorage.com');
    console.log('     Either fix R2_ENDPOINT or fix R2_ACCOUNT_ID so they agree.');
  }
}

console.log('\n--- TLS handshake test ---');
if (!host) {
  console.log('skip — no host to test');
  process.exit(1);
}
const socket = tlsConnect({ host, port: 443, servername: host }, () => {
  console.log('TLS OK:');
  console.log('  protocol:', socket.getProtocol());
  console.log('  cipher  :', socket.getCipher()?.name);
  const cert = socket.getPeerCertificate();
  console.log('  cert CN :', cert?.subject?.CN);
  console.log('  cert SAN:', cert?.subjectaltname?.slice(0, 80) + (cert?.subjectaltname && cert.subjectaltname.length > 80 ? '…' : ''));
  socket.end();
  process.exit(0);
});
socket.on('error', (err) => {
  console.log('TLS FAIL:', err.message);
  process.exit(2);
});
socket.setTimeout(8000, () => {
  console.log('TLS TIMEOUT after 8s');
  socket.destroy();
  process.exit(3);
});
