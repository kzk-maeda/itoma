import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { ProductProviders } from '../src/runtime/product-providers';
import { ApplicationLabels } from '../src/runtime/application-labels';
import { ProductHome } from '../src/components/flow/home';
import { useScreenTime } from '../src/state/screen-time';
import { createDemoSession } from '../src/demo/session';
import { screenTime, historyRecords, onboardingRecords, reflectionRecords } from '../modules/itoma-native';

jest.mock('../src/global.css', () => ({}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn() }, useFocusEffect: (callback: () => void) => require('react').useEffect(callback, []) }));
let refresh: ReturnType<typeof useScreenTime>['refresh'];
function Probe() { refresh = useScreenTime().refresh; useEffect(() => {}, []); return null; }

test('the actual home, Applications and providers consume injected ports without calling native clients', async () => {
  const spies = [screenTime, historyRecords, onboardingRecords, reflectionRecords].map(client => jest.spyOn(client, 'run'));
  try {
    const session = createDemoSession();
    await render(<ApplicationLabels.Provider value={session.applicationLabel}><ProductProviders clients={session.clients}><Probe /><ProductHome /></ProductProviders></ApplicationLabels.Provider>);
    expect(await screen.findByText('自分の時間')).toBeTruthy();
    expect(screen.getByText('X')).toBeTruthy();
    expect(screen.getByText('YouTube')).toBeTruthy();
    expect(screen.getByTestId('home-unlock-entry')).toBeTruthy();
    const value = await session.clients.screenTime.run('snapshot'), target = value.snapshot!.targets[0];
    const preview = await session.clients.screenTime.run('previewUnlock', { targetRef: target.ref, reason: 'テストの確認', minutes: 5 });
    await session.clients.screenTime.run('unlock', { ref: preview.ref, reason: 'テストの確認' });
    await act(async () => { await refresh(); });
    expect(screen.getByText('一時解除中')).toBeTruthy();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally { spies.forEach(spy => spy.mockRestore()); }
});
