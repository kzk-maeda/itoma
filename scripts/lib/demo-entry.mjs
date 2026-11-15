import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Optional, same-directory static entry for a demo export; native routing is untouched. */
export function installDemoEntry(directory) {
  const configPath = join(directory, 'demo-entry.json');
  if (!existsSync(configPath)) return null;
  const { page } = JSON.parse(readFileSync(configPath, 'utf8'));
  if (typeof page !== 'string' || !/^[a-z][a-z0-9-]*\.html$/.test(page) || page === 'index.html') {
    throw new Error('Demo entry must name a static HTML page in the export directory.');
  }
  const source = join(directory, page);
  if (!existsSync(source)) throw new Error(`Demo entry page was not exported: ${page}`);
  cpSync(source, join(directory, 'index.html'));
  return page;
}
