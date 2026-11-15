import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
/** Optional public study selection; never executable configuration or native build input. */
export function readDemoStudy(root) {
  const path = join(root, 'demo.config.json');
  if (!existsSync(path)) return 'app';
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || !['app', 'history'].includes(value.study)) throw new Error('Unknown demo study');
  return value.study;
}
