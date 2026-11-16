import { Stack, usePreventRemove, useSegments } from 'expo-router';
import { type ReactNode, useCallback, useState } from 'react';
import { View } from 'react-native';
import { defaultWorkReturn, type WorkDestination } from '@/lib/navigation-state';
import { edgeBackOptions } from '@/lib/stack-options';
import { useAppNavigation } from './navigation';
import { WorkScopeContext, type ExitGuard } from './work-scope';
import { useScreenTime } from './screen-time';
import { useDraftGuard } from '@/components/flow/navigation';
export { useWorkScope } from './work-scope';

export function WorkFlowLayout() {
  return <WorkFlowBoundary><Stack screenOptions={edgeBackOptions} /></WorkFlowBoundary>;
}
export function WorkFlowBoundary({ children }: { children: ReactNode }) {
  const navigation = useAppNavigation(), segments = useSegments();
  const [guards, setGuards] = useState<ReadonlyMap<string, ExitGuard>>(() => new Map());
  const register = useCallback((id: string, guard?: ExitGuard) => setGuards(previous => {
    const next = new Map(previous); if (guard) next.set(id, guard); else next.delete(id); return next;
  }), []);
  const active = [...guards.values()].filter(value => value.dirty).at(-1);
  const state = useScreenTime();
  // A suspended/hidden child can clean up its effects. Keep root drafts protected between stages.
  useDraftGuard(!active && !!state.ruleDraft?.dirty && !state.ruleExitAllowed, state.canExitRule, () => state.setRuleExitAllowed(true), async () => {
    if (state.busy) return false;
    const ref = state.rulePreviewRef ?? state.ruleReview?.ref;
    if (ref && (await state.run('cancelCandidate', { ref })).status !== 'ok') return false;
    state.setRuleDraft(undefined); state.setRuleReview(undefined); state.setRulePreviewRef(undefined); return true;
  }, state.ruleDraft?.creationCommitted ? '名前と行動目標の未保存入力を破棄します。保存済みの時間のルールは残ります。' : undefined);
  useDraftGuard(!active && (!!state.unlockDraft.reason || !!state.unlockDraft.targetRef || state.unlockDraft.minutes !== '5') && !state.unlockExitAllowed,
    state.canExitUnlock, () => state.setUnlockExitAllowed(true), async () => {
      if (state.busy || (await state.run('cancelUnlock')).status !== 'ok') return false;
      state.resetUnlock(); return true;
    });
  // This boundary is removed only when the whole modal leaves. Internal step-back keeps input.
  usePreventRemove(!!active, ({ repeat }) => { if (active) active.request(repeat); else repeat(); });
  const screen = segments.at(-1) as WorkDestination['screen'];
  const close = () => navigation.close(defaultWorkReturn(screen));
  return <WorkScopeContext.Provider value={{ close, back: () => navigation.stepBack(defaultWorkReturn(screen)), register }}><View style={{ flex: 1 }} accessibilityViewIsModal>
    {children}
  </View></WorkScopeContext.Provider>;
}
