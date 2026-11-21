import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8788';
let ready = false;
for (let i = 0; i < 45; i++) {
  try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* local server starting */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(ready, 'Wrangler preview did not start');
for (const path of ['/', '/privacy/', '/assets/site.css', '/assets/site-mark.svg', '/assets/reading.css', '/assets/reading-800.webp', '/assets/reading-1440.webp']) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('cache-control'), 'no-cache', path);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
const redirect = await fetch(base + '/privacy', { redirect: 'manual' });
assert.equal(redirect.status, 307);
assert.equal(new URL(redirect.headers.get('location'), base).pathname, '/privacy/');
for (const path of ['/missing', '/privacy/missing', '/support-guide.html']) {
  const response = await fetch(base + path);
  assert.equal(response.status, 404, path);
  assert.match(await response.text(), /ページが見つかりません/);
}
console.log('PASS: Wrangler routes, privacy redirect, real 404s, CSP/cache/security headers');
