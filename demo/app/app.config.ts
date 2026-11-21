import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'いとま 画面設計比較デモ',
  slug: 'itoma-decision-demo',
  platforms: ['web'],
  userInterfaceStyle: 'automatic',
  plugins: ['expo-router'],
  web: { output: 'static' },
  experiments: { baseUrl: process.env.ITOMA_DEMO_BASE_PATH ?? '' },
};
export default config;
