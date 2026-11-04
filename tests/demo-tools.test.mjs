import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDemoDeployment, demoTarget, resolveDemoBranch, DEMO_ZONE } from '../scripts/lib/demo-target.mjs';

function fixture(branch = 'feat/settings', sha = 'abc123') {
  const target = demoTarget(branch);
  const manifest = { ...target, commit: sha, dirty: false };
  return {
    sha, branch, dirty: '', manifest, packaged: structuredClone(manifest),
    config: {
      name: target.workerName, workersDev: false, previewUrls: false,
      assets: { basePath: target.basePath },
      triggers: target.routes.map(pattern => ({ type: 'fetch', pattern, zone: DEMO_ZONE })),
    },
  };
}

test('branch identity is stable, bounded, and distinct after normalization', () => {
  const branches = ['feat/a', 'feat-a', 'Feat/A', 'a'.repeat(150) + '/a', 'a'.repeat(150) + '/b', '検証/初回'];
  const targets = branches.map(demoTarget);
  assert.equal(new Set(targets.map(x => x.key)).size, branches.length);
  for (const target of targets) {
    assert.deepEqual(demoTarget(target.branch), target);
    assert.match(target.key, /^[a-z0-9-]+$/);
    assert.ok(target.workerName.length <= 63);
    assert.ok(target.url.endsWith(`${target.basePath}/`));
    assert.ok(!target.basePath.includes('..'));
  }
  assert.throws(() => demoTarget('HEAD'));
  assert.throws(() => demoTarget(''));
});

test('detached PR checkouts use the real head branch, and unknown detached HEAD fails', () => {
  assert.equal(resolveDemoBranch({ GITHUB_HEAD_REF: 'feat/a', GITHUB_REF_NAME: '12/merge' }, 'HEAD'), 'feat/a');
  assert.equal(resolveDemoBranch({ GITHUB_HEAD_REF: 'unrelated' }, 'feat/local'), 'feat/local');
  assert.throws(() => resolveDemoBranch({}, 'HEAD'));
  assert.throws(() => resolveDemoBranch({ GITHUB_REF_NAME: '12/merge' }, 'HEAD'));
  assert.throws(() => resolveDemoBranch({ GITHUB_REF_NAME: 'v1', GITHUB_REF_TYPE: 'tag' }, 'HEAD'));
});

test('deployment permits only the current branch and packaged commit', () => {
  const valid = fixture();
  assert.equal(assertDemoDeployment(valid).branch, valid.branch);
  for (const invalid of [
    { ...valid, dirty: ' M app.json' },
    { ...valid, branch: 'feat/other' },
    { ...valid, sha: 'new-commit' },
    { ...valid, manifest: { ...valid.manifest, dirty: true } },
    { ...valid, packaged: { ...valid.packaged, commit: 'old-commit' } },
    { ...valid, config: { ...valid.config, name: 'itoma-demo' } },
    { ...valid, config: { ...valid.config, workersDev: true } },
    { ...valid, config: { ...valid.config, previewUrls: true } },
    { ...valid, config: { ...valid.config, domains: ['other.example.com'] } },
    { ...valid, config: { ...valid.config, assets: { basePath: '/other' } } },
    { ...valid, config: { ...valid.config, triggers: [{ type: 'fetch', pattern: 'itoma-demo.kzk-maeda.com/*', zone: DEMO_ZONE }] } },
  ]) assert.throws(() => assertDemoDeployment(invalid));
});
