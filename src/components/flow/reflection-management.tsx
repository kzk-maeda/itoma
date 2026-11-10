import { Alert, View } from 'react-native';
import { useReflection } from '@/state/reflection';
import { Body, LinkRow, Notice } from './ui';

export function ReflectionManagement() {
  const state = useReflection();
  const confirmDelete = () => Alert.alert('全記録と累計を削除しますか',
    '操作履歴、理由、振り返りの記録と累計を削除します。ルールと現在の一時解除は変わりません。この操作は元に戻せません。', [
      { text: '戻る', style: 'cancel' },
      { text: '全記録と累計を削除する', style: 'destructive', onPress: () => state.mutate('deleteAll') },
    ]);
  return <View style={{ gap: 8 }}>
    {state.busy && <Body muted>記録への操作を確認しています。</Body>}
    {state.response?.status === 'error' && <Notice title="操作結果を確認できませんでした">{state.response.code === 'capacity-full' ? '記録の保存上限に達しています。不要な理由や操作履歴を削除した後、取込を再試行できます。' : '操作の結果と最新の記録を、もう一度確認してください。'}</Notice>}
    {state.response?.status === 'ok' && <Body muted>操作後の記録を読み直しています。</Body>}
    <LinkRow label="新しい記録を取り込む" disabled={state.busy} onPress={() => state.mutate('import')} />
    <LinkRow label="全記録と累計を削除する" disabled={state.busy} onPress={confirmDelete} />
  </View>;
}
