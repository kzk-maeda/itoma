import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDemoBranch } from './demo-target.mjs';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
export function demoRepo() {
  return {
    sha: git(['rev-parse', 'HEAD']),
    branch: resolveDemoBranch(process.env, git(['rev-parse', '--abbrev-ref', 'HEAD'])),
    dirty: git(['status', '--porcelain', '--untracked-files=normal']),
  };
}
