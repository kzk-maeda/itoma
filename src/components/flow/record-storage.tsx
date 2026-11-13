import type { HistoryPage } from '../../../modules/itoma-native';
import { Body, Heading, Notice, Panel } from './ui';

/** Decimal MB, rounded to hundredths without losing Int64 precision. */
export function storageMB(value: string) {
  if (BigInt(value) > 0n && BigInt(value) < 10_000n) return '< 0.01 MB';
  const hundredths = (BigInt(value) + 5_000n) / 10_000n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')} MB`;
}
export function RecordStoragePanel({ page }: { page: HistoryPage }) {
  const files = page.databaseBytes !== undefined && page.walBytes !== undefined && page.sharedMemoryBytes !== undefined
    ? (BigInt(page.databaseBytes) + BigInt(page.walBytes) + BigInt(page.sharedMemoryBytes)).toString() : undefined;
  return <Panel><Heading>記録の保存容量</Heading>
    <Body>保存内容：{storageMB(page.logicalBytes)} / 上限 {storageMB(page.maximumBytes)}</Body>
    <Body muted>理由・操作・振り返りの保存内容を合わせた量です。警告の目安：{storageMB(page.warningBytes)}。</Body>
    <Body>関連ファイル合計（観測値）：{files === undefined ? '確認できません' : storageMB(files)}</Body>
    <Body muted>記録保存先のDBと作業ファイルの合計で、制限用DBなどは含みません。1 MBは1,000,000バイトです。上限は保存内容に対するもので、アプリ全体やファイルの大きさの上限ではありません。削除後もファイルがすぐ小さくなるとは限りません。</Body>
    {(page.warningReached || page.limitReached) && <Notice title={page.limitReached ? '保存内容の上限です' : '保存内容が増えています'}>不要な記録を設定から削除して、取込を再試行できます。上限では新しい内容の保存を停止します。過去の内容を自動削除しません。</Notice>}
  </Panel>;
}
