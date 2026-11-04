import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'itoma-demo',
    compatibilityDate: '2026-11-01',
    workersDev: false,
    previewUrls: false,
    domains: ['itoma-demo.kzk-maeda.com'],
    observability: { enabled: false },
    assets: { notFoundHandling: '404-page' },
  },
});
