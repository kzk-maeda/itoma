import { Slot } from 'expo-router';
import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import type { CSSProperties } from 'react';
import { OpenCircle } from '../../../../src/components/home/open-circle';
import { GraphiteColors } from '../../../../src/constants/theme';
import { SupportProvider } from '../support/state';
import '../support/design.css';

const vars = Object.fromEntries(Object.entries(GraphiteColors).flatMap(([mode, palette]) =>
  Object.entries(palette).map(([key, value]) => ['--' + mode + '-' + key, value]))) as CSSProperties;
export default function Layout() {
  const page = useRef<HTMLElement>(null), path = usePathname();
  useEffect(() => {
    page.current?.scrollTo(0, 0);
    page.current?.querySelector('h1')?.focus({ preventScroll: true });
  }, [path]);
  return <SupportProvider><main className="support-demo" ref={page} style={vars} lang="ja">
    <header className="mast"><div className="brand"><OpenCircle size={28} color="currentColor" />いとま</div><small>体験デモ · 実際の請求はありません</small></header>
    <Slot />
  </main></SupportProvider>;
}
