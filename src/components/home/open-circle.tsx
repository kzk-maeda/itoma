import identity from '../../../assets/brand/identity.json';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** Fixed upper-left gap (U08), aligned with the 75% time ring; never animated. */
export function OpenCircle({ color, size = 32 }: { color: string; size?: number }) {
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size} viewBox={identity.mark.viewBox} aria-hidden>
      <Path d={identity.mark.path} fill="none" stroke={color} strokeWidth={identity.mark.strokeWidth} strokeLinecap="round" />
    </Svg>
    </View>
  );
}
