import { defineConfig, triggers } from 'cf/config';
import { demoTarget, DEMO_ZONE } from './scripts/lib/demo-target.mjs';
import { demoRepo } from './scripts/lib/demo-repo.mjs';

const target = demoTarget(demoRepo().branch);

export default defineConfig({
  worker: {
    name: target.workerName,
    compatibilityDate: '2026-11-01',
    workersDev: false,
    previewUrls: false,
    triggers: target.routes.map(pattern => triggers.fetch({ pattern, zone: DEMO_ZONE })),
    observability: { enabled: false },
    assets: { notFoundHandling: '404-page' },
  },
});
