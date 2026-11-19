import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { DirectShieldProbeScreen } from '../src/components/flow/direct-shield-probe';
import { directShieldProbe } from '../modules/itoma-native';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../modules/itoma-native', () => ({ directShieldProbe: { available: () => true, run: jest.fn() } }));
jest.mock('../src/state/navigation', () => ({ useAppNavigation: () => ({ finish: jest.fn() }) }));
jest.mock('../src/state/screen-time', () => ({ useScreenTime: () => ({ snapshot: { activation: 'paused' }, run: jest.fn(), busy: undefined }) }));
jest.mock('../src/components/flow/applications', () => ({ Applications: () => null }));
jest.mock('../src/components/flow/ui', () => {
  const RN = require('react-native');
  const wrapper = ({ children }: { children: React.ReactNode }) => <RN.View>{children}</RN.View>;
  return { Body: ({ children }: { children: React.ReactNode }) => <RN.Text>{children}</RN.Text>, Heading: ({ children }: { children: React.ReactNode }) => <RN.Text>{children}</RN.Text>, Panel: wrapper,
    Notice: ({ children, title }: { children: React.ReactNode; title: string }) => <RN.View><RN.Text>{title}</RN.Text><RN.Text>{children}</RN.Text></RN.View>,
    FlowScreen: ({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) => <RN.View>{children}{footer}</RN.View>,
    Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) => <RN.Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}><RN.Text>{label}</RN.Text></RN.Pressable> };
});
beforeEach(() => { process.env.EXPO_PUBLIC_DIRECT_SHIELD_PROBE = '1'; jest.mocked(directShieldProbe.run).mockReset(); });
afterEach(() => { delete process.env.EXPO_PUBLIC_DIRECT_SHIELD_PROBE; jest.restoreAllMocks(); });
test('confirmation cancellation never arms and explicit stop remains available', async () => {
  jest.mocked(directShieldProbe.run).mockResolvedValue({ status: 'ok', authorization: 'approved', snapshot: { phase: 'prepared', id, startsAt: 1000, endsAt: 2200, selectedCount: 1, storeCount: 0, observation: 'none', origin: 'none' } });
  const alert = jest.spyOn(Alert, 'alert');
  await render(<DirectShieldProbeScreen />);
  await screen.findByText('準備済み・予定は未登録です。');
  await fireEvent.press(screen.getByText('この内容で予定を登録する確認へ'));
  expect(alert).toHaveBeenCalled(); expect(directShieldProbe.run).not.toHaveBeenCalledWith('arm', expect.anything());
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[0].onPress?.(); });
  expect(directShieldProbe.run).not.toHaveBeenCalledWith('arm', expect.anything());
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(directShieldProbe.run).toHaveBeenCalledWith('arm', id);
  await fireEvent.press(screen.getByText('今すぐ解除して検証を終了'));
  expect(directShieldProbe.run).toHaveBeenCalledWith('stop', undefined);
});
test('UI entry disabled build does not call native or promise restrictions', async () => {
  delete process.env.EXPO_PUBLIC_DIRECT_SHIELD_PROBE;
  await render(<DirectShieldProbeScreen />);
  expect(screen.getByText('このビルドでは利用できません')).toBeTruthy();
  expect(directShieldProbe.run).not.toHaveBeenCalled();
});
