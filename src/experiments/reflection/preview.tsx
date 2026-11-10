import { ReflectionContent } from '@/components/flow/reflection-content';
import type { ReflectionPrototypeSource } from './model';

/** Fixture entry point remains explicit and unreachable from normal product routes. */
export function ReflectionPrototypePreview({ source, initialAnchor, onDay }: { source: ReflectionPrototypeSource; initialAnchor: string; onDay?: (day: string, token: string) => void }) {
  return <ReflectionContent source={source} initialAnchor={initialAnchor} prototype onDay={onDay ? (day, snapshot) => onDay(day, snapshot.token) : undefined} />;
}
