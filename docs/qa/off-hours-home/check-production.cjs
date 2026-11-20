const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = process.argv[2], repo = process.argv[3] || path.resolve(__dirname, '../../..');
if (!root) throw Error('Usage: node check-production.cjs <export-directory> [source-checkout]');
const files = fs.readdirSync(root, { recursive: true }).filter(file => typeof file === 'string');
const maps = files.filter(file => file.endsWith('.map')), scripts = files.filter(file => file.endsWith('.js'));
const expected = ['src/components/flow/home.tsx', 'src/components/flow/unlock.tsx', 'src/components/home/rule-deck.tsx', 'src/components/home/rule-status.ts', 'src/components/home/rule-status-view.tsx', 'src/components/home/period-ring.tsx', 'src/state/screen-time.tsx', 'src/constants/theme.ts', 'src/components/home/off-hours-presentation.ts', 'src/components/home/off-hours-circle.tsx', 'src/components/home/off-hours-home.tsx', 'src/hooks/use-home-time-context.ts', 'src/components/flow/applications.tsx'];
const seen = new Map(), unwanted = [];
function visit(data) {
 for (let i = 0; i < (data.sources || []).length; i++) {
  const source = data.sources[i];
  if (/src\/demo\/multi-rule|tests\/fixtures\/(scoped|off-hours)|scoped-home-harness/.test(source)) unwanted.push(source);
  for (const name of expected) if (source.endsWith(name) && data.sourcesContent?.[i]) seen.set(name, crypto.createHash('sha256').update(data.sourcesContent[i]).digest('hex'));
 }
 for (const section of data.sections || []) visit(section.map);
}
for (const file of maps) visit(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
const scriptHashes = {};
for (const file of scripts) {
 const content = fs.readFileSync(path.join(root, file));
 if (/__itomaQA|qaClient|qaSetup|scoped-home-web-qa|offHoursSnapshot|src\/demo\/multi-rule/.test(content.toString())) unwanted.push(file);
 scriptHashes[file] = crypto.createHash('sha256').update(content).digest('hex');
}
if (!maps.length || !scripts.length || unwanted.length) throw Error('Missing maps/scripts or fixture contamination: ' + unwanted.join(','));
const sourceHashes = {};
for (const name of expected) {
 const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, name))).digest('hex');
 if (seen.get(name) !== hash) throw Error('Source did not match committed product file: ' + name + ' (' + seen.get(name) + ')');
 sourceHashes[name] = hash;
}
const result = { sourceCommit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), kind: 'normal-web-export-without-qa-patch', mapCount: maps.length, scriptCount: scripts.length, sourceHashes, scriptHashes, unwantedSources: unwanted, passed: true };
fs.writeFileSync(path.join(__dirname, 'production-bundle-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, matchedProductFiles: seen.size, scriptCount: scripts.length, mapCount: maps.length }));
