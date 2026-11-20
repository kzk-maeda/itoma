import { useId } from 'react';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useFlowTheme } from '@/components/flow/ui';
import { DAY, HOUR, MONTH, YEAR, growthReadout } from '../scenarios/time-growth';
import type { CircleStyle } from '../scenarios/circle-styles';
export function GrowthArtwork({ seconds, look }: { seconds?: number; look: CircleStyle }) {
  const gradientID = 'growth-disc-' + useId().replace(/:/g, '');
  const theme = useFlowTheme(), readout = growthReadout(seconds);
  const passed = [HOUR, DAY, MONTH, YEAR].filter(value => seconds !== undefined && seconds >= value);
  const radius = 113, length = 2 * Math.PI * radius, ratio = readout ? readout.ringValue / readout.ringSize : 0;
  return <Svg testID={`growth-visual-${look}`} accessible={false} aria-hidden width="100%" height="100%" viewBox="0 0 278 278">
    {(!seconds && look !== 'original') ? <Circle cx={139} cy={139} r={118} fill="none" stroke={theme.muted} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray={seconds === undefined ? '2 9' : undefined} /> : look === 'rings' ? <>
      {passed.map((_, index) => <Circle key={index} testID="growth-layer" cx={139} cy={139} r={94 + index * 14} fill="none" stroke={theme.accent} strokeOpacity={index === passed.length - 1 ? 1 : 0.7} strokeWidth={index === passed.length - 1 ? 2 : 1.5} />)}
    </> : look === 'ticks' ? <>
      {[{ radius: 130, count: 72, dot: 1.8 }, { radius: 117, count: 64, dot: 1.1 }].map((ring, layer) => Array.from({ length: ring.count }, (_, index) => { const angle = (index + layer * 0.5) / ring.count * Math.PI * 2; return <Circle key={`${layer}-${index}`} cx={139 + ring.radius * Math.sin(angle)} cy={139 - ring.radius * Math.cos(angle)} r={ring.dot} fill={theme.accent} fillOpacity={layer === 0 ? 0.7 : 0.5} />; }))}
    </> : look === 'disc' ? <>
      <Defs><RadialGradient id={gradientID} cx="42%" cy="35%" r="70%"><Stop offset="0" stopColor={theme.background} /><Stop offset="1" stopColor={theme.purposeSurface} /></RadialGradient></Defs>
      <Circle cx={139} cy={139} r={131} fill={theme.soft} />
      <Circle cx={137} cy={136} r={126} fill={`url(#${gradientID})`} />
      <Circle cx={137} cy={136} r={125.5} fill="none" stroke={theme.purposeMotif} strokeWidth={0.7} strokeOpacity={0.18} />
    </> : <>
      <Circle cx={139} cy={139} r={radius} fill="none" stroke={theme.soft} strokeWidth={11} strokeDasharray={seconds === undefined ? '2 9' : undefined} />
      {readout && readout.kind !== 'hours' && <Circle cx={139} cy={139} r={97} fill="none" stroke={theme.accent} strokeOpacity={0.2} strokeWidth={1} />}
      {ratio > 0 && <Circle testID="growth-arc" cx={139} cy={139} r={radius} fill="none" stroke={theme.accent} strokeWidth={11} strokeLinecap="round" strokeDasharray={`${length * ratio} ${length}`} rotation={-90} origin="139, 139" />}
      {[0, 1, 2, 3].map(n => <Circle key={n} cx={139 + 132 * Math.sin(n * Math.PI / 2)} cy={139 - 132 * Math.cos(n * Math.PI / 2)} r={1.8} fill={theme.muted} />)}
    </>}
  </Svg>;
}
