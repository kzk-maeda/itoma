import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDemoStudy } from '../scripts/lib/demo-study.mjs';
test('a study is optional public data with a closed allowlist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'itoma-demo-study-'));
  try {
    assert.equal(readDemoStudy(dir), 'app');
    writeFileSync(join(dir, 'demo.config.json'), '{"study":"history"}');
    assert.equal(readDemoStudy(dir), 'history');
    writeFileSync(join(dir, 'demo.config.json'), '{"study":"../external.js"}');
    assert.throws(() => readDemoStudy(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
