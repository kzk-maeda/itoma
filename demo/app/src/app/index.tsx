import { router, type Href } from 'expo-router';
import { Body, Button } from '@/components/flow/ui';
import { Frame } from '../components/frame';
import { viewOptions } from '../scenarios/visual-options';
export default function Home() { return <Frame title="いとま" tab="home"><Body>時間が積み重なって、日・月・年の長さになる振り返り。</Body><Button label="新しい振り返りを見る" onPress={() => router.navigate('/reflection')} /><Body muted>以前の案と比較する</Body>{viewOptions.map(value => <Button key={value.path} secondary label={value.label} onPress={() => router.navigate(value.path as Href)} />)}</Frame>; }
