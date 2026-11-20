import { router } from 'expo-router';
import { Body, Button } from '@/components/flow/ui';
import { Frame } from '../components/frame';
export default function Settings() { return <Frame title="設定" tab="settings"><Body>このデモは、振り返りのグラフを比較するものです。</Body><Button secondary label="振り返りに戻る" onPress={() => router.dismissTo('/reflection')} /></Frame>; }
