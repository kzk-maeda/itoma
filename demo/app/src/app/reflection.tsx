import { useEffect, useState } from 'react';
import { GrowthToolbar } from '../components/growth-toolbar';
import { useLocalSearchParams } from 'expo-router';
import { LandscapeScreen } from '../components/landscape-screen';
import { TimeGrowthPreview } from '../components/time-growth-preview';

export default function Reflection() {
  // The static export has no query string. Hydrate its default first, then open the linked scene.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const { look, scene } = useLocalSearchParams<{ look?: string; scene?: string }>();
  return ready && look
    ? <><GrowthToolbar /><TimeGrowthPreview /></>
    : <LandscapeScreen scene={ready ? scene : undefined} />;
}
