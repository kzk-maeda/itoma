import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'itoma',
  slug: config.slug ?? 'itoma',
  ios: {
    ...config.ios,
    // Local build opt-in only. This neither selects a Team nor registers/signs an App ID.
    ...(process.env.ITOMA_SCREEN_TIME_POC === '1' ? {
      infoPlist: { ...config.ios?.infoPlist, ITOMAScreenTimePoC: true },
      entitlements: { ...config.ios?.entitlements, 'com.apple.developer.family-controls': true },
    } : {}),
  },
  experiments: {
    ...config.experiments,
    ...(process.env.ITOMA_DEMO_BUILD === '1'
      ? { baseUrl: process.env.ITOMA_DEMO_BASE_PATH }
      : {}),
  },
  web: {
    ...config.web,
    ...(process.env.ITOMA_DEMO_BUILD === '1' ? { output: 'static' as const } : {}),
  },
});
