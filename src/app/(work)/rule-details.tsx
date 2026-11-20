import { useLocalSearchParams } from 'expo-router';
import { RuleDetailsScreen } from '@/components/flow/rule-details';
export default function RuleDetailsRoute() {
  const { ruleID } = useLocalSearchParams<{ ruleID?: string }>();
  return <RuleDetailsScreen ruleID={typeof ruleID === 'string' ? ruleID : undefined} />;
}
