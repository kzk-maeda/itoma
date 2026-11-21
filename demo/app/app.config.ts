import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'いとま · いとまを支える',
  slug: 'itoma-support-demo',
  platforms: ['web'],
  plugins: ['expo-router'],
  web: { output: 'static' },
  experiments: { baseUrl: process.env.ITOMA_DEMO_BASE_PATH ?? '' },
};
export default config;
