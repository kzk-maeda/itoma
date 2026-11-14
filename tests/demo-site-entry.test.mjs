import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDemoEntry } from '../scripts/lib/demo-entry.mjs';

test('demo root serves a same-directory site and preserves an unspecified application entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'itoma-site-entry-'));
  try {
    writeFileSync(join(dir, 'index.html'), 'original application');
    assert.equal(installDemoEntry(dir), null);
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), 'original application');
    writeFileSync(join(dir, 'demo-entry.json'), JSON.stringify({ page: 'service-site.html' }));
    assert.throws(() => installDemoEntry(dir), /not exported/);
    writeFileSync(join(dir, 'service-site.html'), '<a href="privacy-guide.html">privacy</a>');
    assert.equal(installDemoEntry(dir), 'service-site.html');
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), readFileSync(join(dir, 'service-site.html'), 'utf8'));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
test('demo entry refuses traversal, external URLs and replacing index with itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'itoma-site-entry-'));
  try {
    for (const page of ['../secret.html', '/site.html', 'https://example.com/index.html', 'index.html']) {
      writeFileSync(join(dir,'demo-entry.json'), JSON.stringify({ page }));
      assert.throws(() => installDemoEntry(dir), /static HTML/);
    }
  } finally { rmSync(dir, { recursive:true, force:true }); }
});
