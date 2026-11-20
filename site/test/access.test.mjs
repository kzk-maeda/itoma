import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access, assertAccessRedirect, checkAccess, protectedPaths } from '../scripts/check-access.mjs';

const login = `${access.teamOrigin}/cdn-cgi/access/login/itoma.app?kid=${access.audience}`;
const response = (status = 302, location = login) => new Response(null, {
  status, headers: location === null ? {} : { location },
});

test('only the site-specific Access login is accepted', () => {
  assert.doesNotThrow(() => assertAccessRedirect(response()));
  for (const value of [response(200), response(403), response(302, null),
    response(302, '/login'), response(302, login.replace(access.audience, 'other-app')),
    response(302, login.replace('itoma.app?', 'other.example?')),
    response(302, login.replace('https:', 'http:')),
    response(302, login.replace('.cloudflareaccess.com/', '.cloudflareaccess.com.attacker.example/'))]) {
    assert.throws(() => assertAccessRedirect(value));
  }
});

test('anonymous checks include pages, assets, and unknown paths without forwarding credentials', async () => {
  const paths = [];
  await checkAccess(async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers.authorization, undefined);
    return response();
  });
  assert.deepEqual(paths, protectedPaths);
});

test('public content or a network failure stops at the failing path', async () => {
  let calls = 0;
  await assert.rejects(checkAccess(async () => { calls++; return response(200); }));
  assert.equal(calls, 1);
  await assert.rejects(checkAccess(async () => { throw Error('DNS unavailable'); }));
});

test('the prelaunch deployment has no alternate public hostname', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: 'itoma.app', custom_domain: true }]);
});
