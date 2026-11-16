import { activeBrowse, appStack, browsePath, canonicalStack, type BrowseDestination, type NavigationTree } from '../src/lib/navigation-state';

const ruleID = '11111111-1111-1111-1111-111111111111';
const destinations: BrowseDestination[] = [{ screen: 'grant' }, { screen: 'history-reason' }, { screen: 'settings-schedule', ruleID }, { screen: 'settings-storage' }, { screen: 'settings-delete' }];
test.each(destinations)('a direct $screen entry gets its logical parents and preserves the existing leaf instance', destination => {
  const leaf = { key: 'existing-leaf', name: destination.screen, ...('ruleID' in destination ? { params: { ruleID: destination.ruleID } } : {}) };
  const stack = { key: 'existing-stack', stale: false, routeKeySeq: 10, index: 0, routes: [leaf] };
  const next = canonicalStack(stack, destination)!;
  expect(next.routes.at(-1)).toBe(leaf);
  expect(next.routes.map(route => route.name)).toEqual(browsePath(destination).chain.map(route => route.name));
  expect(next.key).toBe('existing-stack');
  expect(canonicalStack(next, destination)).toBeUndefined();
});

test('cross-feature links replace unrelated history, preserve matching parent keys and stay bounded over 100 visits', () => {
  const settings = { key: 'settings-key', name: 'settings' }, records = { key: 'records-key', name: 'settings-records' };
  let stack: NavigationTree = { key: 'stack', index: 2, routes: [settings, { name: 'settings-schedules' }, { name: 'settings-schedule', params: { ruleID } }] };
  for (let n = 0; n < 100; n++) {
    stack = canonicalStack(stack, { screen: n % 2 ? 'settings-delete' : 'settings-storage' })!;
    expect(stack.routes).toHaveLength(3); expect(stack.routes[0]).toBe(settings);
    expect(stack.routes.some(route => route.name === 'settings-schedule')).toBe(false);
    // Emulate the Router assigning its own key to a new logical parent.
    stack = { ...stack, routes: [settings, records, stack.routes[2]] };
  }
  expect(canonicalStack(stack, { screen: 'settings-storage' })!.routes[1]).toBe(records);
});

test('ownership follows the navigator category through the SDK root wrapper, without changing inactive tab state', () => {
  const settings = { key: 'settings', index: 1, routes: [{ name: 'settings' }, { name: 'settings-about' }] };
  const reflection = { key: 'reflection', index: 1, routes: [{ name: 'reflection' }, { name: 'history' }] };
  const tabs = { index: 1, routes: [{ name: '(settings)', state: settings }, { name: '(reflection)', state: reflection }] };
  const app = { index: 0, routes: [{ name: '(main)', state: tabs }] };
  const root = { index: 0, routes: [{ name: '__root', state: app }] };
  expect(appStack(root)).toBe(app);
  expect(activeBrowse(root)).toEqual({ stack: reflection, destination: { screen: 'history' } });
  expect(canonicalStack(reflection, { screen: 'history' })).toBeUndefined();
  expect(tabs.routes[0].state).toBe(settings);
  expect(activeBrowse({ ...root, routes: [{ name: '__root', state: { ...app, index: 1, routes: [...app.routes, { name: '(work)' }] } }] })).toBeUndefined();
});
