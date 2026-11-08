import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Optional demo-only entry. Does not change Expo/native application routing. */
export function installDemoEntry(directory) {
  const configPath = join(directory, 'demo-entry.json');
  if (!existsSync(configPath)) return null;
  const { page } = JSON.parse(readFileSync(configPath, 'utf8'));
  // A same-directory static HTML page keeps all relative asset URLs valid.
  if (typeof page !== 'string' || !/^[a-z][a-z0-9-]*\.html$/.test(page) || page === 'index.html') {
    throw new Error('Demo entry must name a static HTML page in the export directory.');
  }
  const source = join(directory, page);
  if (!existsSync(source)) throw new Error(`Demo entry page was not exported: ${page}`);
  cpSync(source, join(directory, 'index.html'));
  return page;
}
