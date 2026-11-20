import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Heading, useFlowTheme } from '@/components/flow/ui';
import { ProductNavigation } from '@/components/flow/product-navigation';
import { RuleGoal } from '@/components/flow/rule-identity';
import { OpenCircle } from '@/components/home/open-circle';
import { PeriodRing } from '@/components/home/period-ring';
import { presentPeriod } from '@/components/home/period-presentation';
import { sampleNow } from '../scenarios/home';
import { useDemo } from '../state/demo';
import { OffHoursCircle } from './off-hours-circle';

export function HomePreview() {
  const theme = useFlowTheme(), { scenario } = useDemo();
  const active = scenario.id === 'active';
  const period = presentPeriod(sampleNow - 30 * 60_000, sampleNow + 90 * 60_000, sampleNow);
  return <View style={{ flex: 1, backgroundColor: theme.surface }}>
    <ScrollView testID="home-scroll" contentContainerStyle={styles.content}>
      <View style={styles.brand}><OpenCircle color={theme.accent} size={28} /><Text accessibilityRole="header" style={[styles.brandName, { color: theme.text }]}>いとま</Text></View>
      {active ? <View style={{ gap: 12 }}>
        <Text style={[styles.caption, { color: theme.muted }]}>いま適用しているルール</Text>
        <Heading>{scenario.title}</Heading>
        {period.state === 'current' && <PeriodRing period={period} theme={theme} />}
        <RuleGoal goal={scenario.goal} />
        <View style={styles.appRow}><Body>X</Body><Body>Instagram</Body></View>
        <Text style={[styles.caption, { color: theme.muted }]}>制限中の表示比較です。解除操作は元のルール別デモで確認できます。</Text>
      </View> : <>
        <OffHoursCircle next={scenario.date && scenario.startTime ? { date: scenario.date, time: scenario.startTime } : undefined} />
        {scenario.title ? <View testID="next-rule" style={[styles.next, { backgroundColor: theme.background, borderColor: theme.line }]}>
          <View style={styles.nextLabel}><View style={[styles.dot, { backgroundColor: theme.muted }]} /><Text style={[styles.caption, { color: theme.muted }]}>次のルール</Text></View>
          <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[styles.ruleTitle, { color: theme.text }]}>{scenario.title}</Text>
            <Text style={[styles.ruleTime, { color: theme.text }]}>{scenario.endTime}に終了</Text></View>
          <View style={styles.appRow}>{scenario.apps.map(name => <View key={name} style={[styles.app, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22 }}>{name}</Text>
          </View>)}</View>
          <RuleGoal goal={scenario.goal} />
        </View> : <View testID="no-next-rule" style={[styles.next, { backgroundColor: theme.background, borderColor: theme.line }]}>
          <Heading>ルールの設定</Heading><Body muted>設定したルールは、設定タブで確認できます。</Body>
          <Button secondary label="ルールを確認する" onPress={() => router.navigate('/settings')} />
        </View>}
      </>}
    </ScrollView>
    <ProductNavigation current="home" theme={theme} />
  </View>;
}
const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32, gap: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 }, brandName: { fontSize: 22, lineHeight: 36, letterSpacing: 3, fontWeight: '500' },
  next: { padding: 20, borderWidth: 1, borderRadius: 20, gap: 16 }, nextLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 3 }, caption: { fontSize: 13, lineHeight: 21 },
  ruleTitle: { fontSize: 21, lineHeight: 32, fontWeight: '500' }, ruleTime: { fontSize: 16, lineHeight: 26, fontVariant: ['tabular-nums'] },
  appRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, app: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
});
