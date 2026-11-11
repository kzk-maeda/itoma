import type { ScreenTimeSnapshot } from '../../modules/itoma-native/src/screen-time';

const atLeast = (a: string, b: string) => a.length > b.length || (a.length === b.length && a >= b);
/** Control and host-private text have independent revisions; late reads must not undo either. */
export function currentControlSnapshot(previous: ScreenTimeSnapshot | undefined, incoming: ScreenTimeSnapshot) {
  const selected = !previous || incoming.storage !== 'ready' || atLeast(incoming.sequence, previous.sequence) ? incoming : previous;
  if (!previous || selected.ruleDetailsStatus !== 'ready' || previous.ruleDetailsStatus !== 'ready' || incoming.ruleDetailsStatus !== 'ready'
    || previous.ruleDetailsRevision === undefined || incoming.ruleDetailsRevision === undefined) return selected;
  const metadata = atLeast(incoming.ruleDetailsRevision, previous.ruleDetailsRevision) ? incoming : previous;
  if (metadata === selected) return selected;
  return { ...selected, ruleDetailsRevision: metadata.ruleDetailsRevision,
    rules: selected.rules.map(rule => {
      const details = metadata.rules.find(r => r.id === rule.id);
      return details ? { ...rule, title: details.title, goal: details.goal } : rule;
    }) };
}
