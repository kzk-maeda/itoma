import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** Fixed OPEN CIRCLE direction (U08); independent of time, progress and loading. */
export function OpenCircle({ color, size = 32 }: { color: string; size?: number }) {
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <Path d="M 20 5 A 15 15 0 1 0 35 20" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
    </View>
  );
}
