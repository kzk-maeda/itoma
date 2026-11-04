import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'itoma',
  slug: config.slug ?? 'itoma',
  web: {
    ...config.web,
    ...(process.env.ITOMA_DEMO_BUILD === '1' ? { output: 'static' as const } : {}),
  },
});
