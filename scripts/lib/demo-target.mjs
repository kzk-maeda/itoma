import { createHash } from 'node:crypto';

export const DEMO_HOST = 'itoma-demo.kzk-maeda.com';
export const DEMO_ZONE = 'kzk-maeda.com';

/** Build/inspect any branch, but deploy only an explicit demo namespace. */
export function isDemoDeploymentBranch(branch) {
  return typeof branch === 'string' && branch.startsWith('demo/') && branch.length > 'demo/'.length;
}

/** @param {string} branch */
export function demoTarget(branch) {
  if (!branch || branch === 'HEAD' || branch.trim() !== branch || /[\x00-\x20\x7f]/.test(branch)) {
    throw new Error('A named Git branch is required for a demo.');
  }
  const readable = branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 36).replace(/-$/, '') || 'branch';
  const hash = createHash('sha256').update(branch).digest('hex').slice(0, 12);
  const key = `${readable}-${hash}`;
  const basePath = `/demos/${key}`;
  return {
    branch,
    key,
    basePath,
    workerName: `itoma-demo-${key}`,
    url: `https://${DEMO_HOST}${basePath}/`,
    routes: [`${DEMO_HOST}${basePath}`, `${DEMO_HOST}${basePath}/*`],
  };
}

/** @param {Record<string, string | undefined>} env @param {string} gitBranch */
export function resolveDemoBranch(env, gitBranch) {
  if (gitBranch !== 'HEAD') return gitBranch;
  // GitHub PR checkouts are detached. Never use the pull/<id>/merge ref as a branch.
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;
  if (!branch || /^\d+\/merge$/.test(branch) || (env.GITHUB_REF_TYPE && env.GITHUB_REF_TYPE !== 'branch')) {
    throw new Error('Detached HEAD requires a GitHub branch context. Check out a branch locally.');
  }
  return branch;
}

/** @param {{sha: string, branch: string, dirty: string, manifest: any, packaged: any, config: any}} input */
export function assertDemoDeployment({ sha, branch, dirty, manifest, packaged, config }) {
  if (!isDemoDeploymentBranch(branch)) {
    throw new Error('Demo deployment requires a demo/<name> branch. Create a demo branch and rebuild.');
  }
  const target = demoTarget(branch);
  if (dirty || manifest.dirty || manifest.commit !== sha || manifest.branch !== branch || JSON.stringify(manifest) !== JSON.stringify(packaged)) {
    throw new Error('Commit changes, then run npm run demo:package on this exact branch and commit.');
  }
  if (manifest.key !== target.key || manifest.basePath !== target.basePath || manifest.workerName !== target.workerName ||
      config.name !== target.workerName || config.assets?.basePath !== undefined || config.workersDev !== false || config.previewUrls !== false ||
      (config.domains?.length ?? 0) !== 0 || JSON.stringify(config.triggers) !== JSON.stringify(target.routes.map(pattern => ({ type: 'fetch', pattern, zone: DEMO_ZONE })))) {
    throw new Error('Packaged Worker configuration does not match the branch demo target. Rebuild before deploying.');
  }
  return target;
}
