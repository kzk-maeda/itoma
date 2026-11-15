import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist`;
// Clean only our own output; never copy Expo public/ or policy planning documents.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(`${root}src`, output, { recursive: true });
function validate(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) validate(path);
    else if (entry.name.endsWith('.html') && /［要確定|\[要確定|support-guide|デザインデモ/.test(readFileSync(path, 'utf8'))) {
      throw new Error(`Internal/demo content in publication: ${path}`);
    }
  }
}
validate(output);
writeFileSync(`${output}/_headers`, `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: no-cache
`);
console.log('Built site/dist (LP, privacy status, 404, local assets).');
