/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Adopted U07 palette shared by the home and manual device flow. */
export const GraphiteColors = {
  light: { background: '#F4F3F0', surface: '#FFFFFF', text: '#30312F', muted: '#666762',
    line: '#DDDDD6', accent: '#444842', soft: '#E7E8E1', onAccent: '#FFFFFF',
    purposeSurface: '#E7E2D9', purposeMotif: '#656052' },
  dark: { background: '#1B1C1A', surface: '#292B27', text: '#F0F0E9', muted: '#BDBFB6',
    line: '#4D5048', accent: '#CDD2C4', soft: '#3A3E35', onAccent: '#23271F',
    purposeSurface: '#37362F', purposeMotif: '#CEC8B8' },
} as const;

export type GraphiteTheme = (typeof GraphiteColors)['light' | 'dark'];
export const HomeLayout = { maxWidth: 480, gutter: 24, sectionGap: 24 } as const;

/** Brief responses to period selection; never used for domain deadlines. */
export const FlowMotion = { periodDuration: 180, periodOffset: 16 } as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
