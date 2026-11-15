import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HistoryRow } from '../../../modules/itoma-native';
import { HistoricalChoices } from '@/runtime/history-context';
import { canReadChoiceReason, choiceRecordTitle, choiceStatus, dateLabel, dayAt, moveDay, timeLabel } from './history-presentation';
import { useFlowTheme } from './ui';

/** The rail shows record order, never elapsed time or continuous app activity. */
export function HistoryTimeline({ rows, zone, today, busy, onOpen }: {
  rows: HistoryRow[]; zone: string; today: string; busy: boolean; onOpen: (row: HistoryRow) => void;
}) {
  const theme = useFlowTheme(), contexts = useContext(HistoricalChoices);
  return <View testID="history-timeline">
    <Text style={[styles.caption, { color: theme.muted }]}>新しい記録から</Text>
    {rows.map((row, index) => {
      const day = dayAt(row.at, zone), first = index === 0 || dayAt(rows[index - 1].at, zone) !== day;
      const continues = index + 1 < rows.length && dayAt(rows[index + 1].at, zone) === day;
      const context = contexts?.(row), title = choiceRecordTitle(row, context?.applicationLabel);
      return <View key={row.key}>
        {first && <View style={styles.dayHeading}>
          <Text accessibilityRole="header" style={[styles.day, { color: theme.text }]}>{day === today ? '今日' : day === moveDay(today, -1) ? '昨日' : dateLabel(day)}</Text>
          {(day === today || day === moveDay(today, -1)) && <Text style={[styles.caption, { color: theme.muted }]}>{dateLabel(day)}</Text>}
        </View>}
        <View style={styles.entry}>
          <View accessible={false} pointerEvents="none" style={styles.rail}>
            {continues && <View style={[styles.line, { backgroundColor: theme.line }]} />}
            <View style={[styles.dot, { borderColor: theme.muted, backgroundColor: theme.background }]} />
          </View>
          <View style={styles.content}>
            <Text style={[styles.time, { color: theme.muted }]}>{timeLabel(row.at, zone)} の記録</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
              accessibilityLabel={`${title}、${timeLabel(row.at, zone)}、${choiceStatus(row)}。詳細を見る`}
              testID={`history-choice-${row.key}`} onPress={() => onOpen(row)}
              style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.75 : 1 }]}>
              <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
              {context?.ruleTitle && <Text style={[styles.caption, { color: theme.muted }]}>ルール：{context.ruleTitle}</Text>}
              <Text style={[styles.status, { color: theme.text, backgroundColor: theme.soft }]}>{choiceStatus(row)}</Text>
              {(context?.requestedMinutes !== undefined || row.expiresAt !== undefined) && <View style={styles.facts}>
                {context?.requestedMinutes !== undefined && <Text style={[styles.caption, { color: theme.muted }]}>希望 {context.requestedMinutes}分</Text>}
                {row.expiresAt !== undefined && <Text style={[styles.caption, { color: theme.muted }]}>記録上の上限 {timeLabel(row.expiresAt, zone)}</Text>}
              </View>}
              <View style={[styles.action, { borderColor: theme.line }]}>
                <Text style={[styles.actionText, { color: theme.text }]}>{row.reasonDeleted ? '理由は削除済み · 結果を見る' : canReadChoiceReason(row) ? '理由と結果を見る' : '記録を見る'}　›</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  caption: { fontSize: 13, lineHeight: 21 }, dayHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginTop: 24, marginBottom: 16 },
  day: { fontSize: 18, lineHeight: 28, fontWeight: '600' }, entry: { flexDirection: 'row', gap: 12 },
  rail: { width: 16, alignSelf: 'stretch', alignItems: 'center' }, line: { position: 'absolute', top: 10, bottom: -10, width: 1 },
  dot: { width: 10, height: 10, borderWidth: 2, borderRadius: 5, marginTop: 6 }, content: { flex: 1, minWidth: 0, paddingBottom: 24, gap: 10 },
  time: { fontSize: 13, lineHeight: 22, fontVariant: ['tabular-nums'] }, card: { padding: 18, borderWidth: 1, borderRadius: 18, gap: 10, minHeight: 88 },
  title: { fontSize: 18, lineHeight: 28, fontWeight: '500' }, status: { alignSelf: 'flex-start', fontSize: 12, lineHeight: 20, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 }, action: { borderTopWidth: 1, paddingTop: 12, marginTop: 2 },
  actionText: { fontSize: 14, lineHeight: 23 },
});
