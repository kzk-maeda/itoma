import { Text, View } from 'react-native';
import type { ScreenTimeRule } from '../../../modules/itoma-native';
import { Body, useFlowTheme } from './ui';

export const ruleTitle = (rule: ScreenTimeRule | undefined, index: number) => rule?.title?.trim() || `時間帯 ${Math.max(1, index + 1)}`;
export function RuleGoal({ goal }: { goal?: string }) {
  const theme = useFlowTheme();
  if (!goal?.trim()) return null;
  return <View testID="rule-goal" style={{ backgroundColor: theme.purposeSurface, padding: 20, borderRadius: 16, gap: 8 }}>
    <Text style={{ color: theme.purposeMotif, fontSize: 13, lineHeight: 20 }}>この時間に大切にしたいこと</Text><Body>{goal}</Body>
  </View>;
}
