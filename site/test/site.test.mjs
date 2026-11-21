import { wordmarkHTML, wordmarkCSS, faviconSVG } from '../../assets/brand/render.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
const pages = ['index.html', 'privacy/index.html', '404.html'];

test('all local navigation, assets, and fragments resolve; external actions are explicit', () => {
  for (const page of pages) {
    const html = readFileSync(`${root}dist/${page}`, 'utf8');
    assert.match(html, /<html lang="ja">/);
    assert.match(html, /mailto:support@itoma\.app/);
    assert.doesNotMatch(html, /<script|<form|target="_blank"|［要確定|デザインデモ/);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https:|mailto:)/.test(href)) continue;
      const url = new URL(href, `https://itoma.app/${page}`);
      const target = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      assert.ok(existsSync(`${root}dist${target}`), `${page}: ${href}`);
      if (url.hash) assert.ok(readFileSync(`${root}dist${target}`, 'utf8').includes(`id="${url.hash.slice(1)}"`), href);
    }
  }
});

test('publication contains only site assets; clean builds remove stale pages', () => {
  writeFileSync(`${root}dist/obsolete.html`, 'stale');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  assert.equal(existsSync(`${root}dist/obsolete.html`), false);
  for (const path of ['content', 'node_modules', 'support-guide.html', 'service-site.html']) assert.equal(existsSync(`${root}dist/${path}`), false);
  const privacy = readFileSync(`${root}dist/privacy/index.html`, 'utf8');
  assert.match(privacy, /Kazuki Maeda/);
  assert.match(privacy, /正式なプライバシーポリシーは準備中/);
  assert.doesNotMatch(privacy, /180日|制定日/); // Conditional retention decision is not an adopted promise.
});

test('build rejects unresolved drafting placeholders in published source', () => {
  const fixture = `${root}src/internal-draft.html`;
  try {
    writeFileSync(fixture, '［要確定：事業者］');
    assert.throws(() => execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' }));
  } finally {
    rmSync(fixture, { force: true });
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  }
});

test('all three published pages share the accessible wordmark and generated assets', () => {
  for (const page of pages) {
    const html = readFileSync(`${root}dist/${page}`, 'utf8');
    assert.equal(html.split(wordmarkHTML).length - 1, 2, page);
    assert.match(html, /href="\/assets\/wordmark\.css"/);
  }
  assert.equal(readFileSync(`${root}dist/assets/wordmark.css`, 'utf8'), wordmarkCSS);
  assert.equal(readFileSync(`${root}dist/assets/site-mark.svg`, 'utf8'), faviconSVG());
});
