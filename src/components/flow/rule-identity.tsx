import { Text, View } from 'react-native';
import type { ScreenTimeRule } from '../../../modules/itoma-native';
import { Body, Field, Notice, useFlowTheme } from './ui';

export const invalidRuleIdentity = (title: string, goal: string) => title.length > 80 || goal.length > 1000 || (title + goal).includes('\0');
export function RuleIdentityFields({ title, goal, disabled, onChange }: { title: string; goal: string; disabled: boolean; onChange: (patch: { title?: string; goal?: string }) => void }) {
  return <>
    <Field label="ルール名（任意）" value={title} editable={!disabled} onChangeText={title => onChange({ title })} />
    <Body muted>未入力なら「時間帯」の名前を表示します。80文字以内で入力してください。</Body>
    <Field label="行動目標（任意）" value={goal} editable={!disabled} multiline onChangeText={goal => onChange({ goal })} />
    <Body muted>このルールを設定した理由や、この時間にしたいこと。1,000文字以内で入力してください。登録した内容はホームに表示します。</Body>
    {invalidRuleIdentity(title, goal) && <Notice title="入力内容を確認してください">文字数の上限を超えているか、使用できない文字が含まれています。入力を短くしてから保存できます。</Notice>}
  </>;
}

export const ruleTitle = (rule: ScreenTimeRule | undefined, index: number) => rule?.title?.trim() || `時間帯 ${Math.max(1, index + 1)}`;
export function RuleGoal({ goal }: { goal?: string }) {
  const theme = useFlowTheme();
  if (!goal?.trim()) return null;
  return <View testID="rule-goal" style={{ backgroundColor: theme.purposeSurface, padding: 20, borderRadius: 16, gap: 8 }}>
    <Text style={{ color: theme.purposeMotif, fontSize: 13, lineHeight: 20 }}>この時間に大切にしたいこと</Text><Body>{goal}</Body>
  </View>;
}
