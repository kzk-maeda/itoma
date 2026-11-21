import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'いとま · 一時解除の選び方',
  slug: 'itoma-unlock-choices',
  platforms: ['web'],
  plugins: ['expo-router'],
  web: { output: 'static' },
  experiments: { baseUrl: process.env.ITOMA_DEMO_BASE_PATH ?? '' },
};
export default config;
