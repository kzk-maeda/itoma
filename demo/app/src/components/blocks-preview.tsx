import { Text, View } from 'react-native';
import { Body, useFlowTheme } from '@/components/flow/ui';
import { reflectionDuration } from '../../../../modules/itoma-native/src/reflection-model';
import { useDemo } from '../state/demo';
import { sumKnown } from '../scenarios/records';
import { timeBlocks } from '../scenarios/visual-options';
import { Frame } from './frame';
import { Caption, PeriodBreakdown, TotalCard } from './visual-shared';
export function BlocksPreview() {
  const { dataset } = useDemo(), theme = useFlowTheme(), total = sumKnown(dataset.days), blocks = timeBlocks(total ?? 0);
  return <Frame title="振り返り" tab="reflection"><TotalCard>
    {total === undefined ? <Body muted>まだ時間の記録がありません。</Body> : total === 0 ? <Body muted>記録はありますが、集計対象の時間は0分です。</Body> : <>
      <View testID="time-blocks" accessible accessibilityRole="image" accessibilityLabel={`${reflectionDuration(total)}を時間のブロックで表示。1ブロックは${reflectionDuration(blocks.unit)}、${total % blocks.unit ? `最後の端数は${reflectionDuration(total % blocks.unit)}` : '端数なし'}。`}>
        <View accessible={false} aria-hidden style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 }}>{blocks.blocks.map((seconds, n) => <View key={n} testID={seconds === blocks.unit ? 'full-block' : 'partial-block'} style={{ width: Math.max(4, 40 * seconds / blocks.unit), height: 48, borderRadius: 5, backgroundColor: theme.accent }} />)}</View>
      </View><Caption>1ブロック＝{reflectionDuration(blocks.unit)}</Caption>
      <Text style={{ fontSize: 14, lineHeight: 23, color: theme.text }}>記録した時間を、一定のまとまりで並べています。</Text>
    </>}
  </TotalCard><PeriodBreakdown /></Frame>;
}
