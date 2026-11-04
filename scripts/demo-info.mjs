import { demoTarget } from './lib/demo-target.mjs';
import { demoRepo } from './lib/demo-repo.mjs';

console.log(JSON.stringify(demoTarget(demoRepo().branch), null, 2));
