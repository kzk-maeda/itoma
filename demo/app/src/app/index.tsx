import { router, type Href } from 'expo-router';
import { Body, Button } from '@/components/flow/ui';
import { Frame } from '../components/frame';
import { viewOptions } from '../scenarios/visual-options';
export default function Home() { return <Frame title="いとま" tab="home"><Body>同じ記録を、5つの見え方で比べられます。</Body>{viewOptions.map(value => <Button key={value.path} secondary label={value.label} onPress={() => router.navigate(value.path as Href)} />)}</Frame>; }
