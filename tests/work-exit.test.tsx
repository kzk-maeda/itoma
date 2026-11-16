import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRef, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { WorkFlowBoundary, useWorkScope } from '../src/state/work-flow';
import { useDraftGuard } from '../src/components/flow/navigation';
import { FlowScreen } from '../src/components/flow/ui';

jest.mock('../src/global.css', () => ({}));

const mockGuards = new Map<string, (event: { repeat: () => void }) => void>();
const mockRemoved = jest.fn();
function mockExit() { const guard = [...mockGuards.values()].at(-1); if (guard) guard({ repeat: mockRemoved }); else mockRemoved(); }
jest.mock('expo-router', () => ({ router: { dismissTo: () => mockExit(), back: () => mockExit() }, useSegments: () => ['(work)', 'rule-confirm'],
  usePreventRemove: (dirty: boolean, callback: (event: { repeat: () => void }) => void) => {
    const id = require('react').useId();
    require('react').useEffect(() => { if (dirty) mockGuards.set(id, callback); else mockGuards.delete(id); return () => { mockGuards.delete(id); }; }, [id, dirty, callback]);
  },
}));
jest.mock('../src/state/screen-time', () => ({ useScreenTime: () => ({ unlockDraft: { reason: '', minutes: '5' } }) }));
function Editor({ discard }: { discard: () => Promise<boolean> }) {
  const allowed = useRef(false), [step, setStep] = useState('input');
  useDraftGuard(true, () => allowed.current, () => { allowed.current = true; }, discard);
  const scope = useWorkScope()!;
  return <FlowScreen title="編集" onBack={scope.back}><Text>{step}</Text><Pressable accessibilityRole="button" accessibilityLabel="next step" onPress={() => setStep('review')} /></FlowScreen>;
}
beforeEach(() => { mockGuards.clear(); mockRemoved.mockClear(); });
test('internal steps keep input, while closing the modal and external removal share one discard guard', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), discard = jest.fn(async () => true);
  const view = await render(<WorkFlowBoundary><Editor discard={discard} /></WorkFlowBoundary>);
  await fireEvent.press(screen.getByRole('button', { name: 'next step' }));
  expect(screen.getByText('review')).toBeTruthy(); expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '閉じる' }));
  expect(alert).toHaveBeenCalledTimes(1); expect(mockRemoved).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[0].onPress?.());
  expect(discard).not.toHaveBeenCalled(); expect(screen.getByText('review')).toBeTruthy();
  await act(async () => mockExit());
  await act(async () => { const confirm = alert.mock.calls.at(-1)?.[2]?.[1].onPress; confirm?.(); confirm?.(); });
  expect(discard).toHaveBeenCalledTimes(1); expect(mockRemoved).toHaveBeenCalledTimes(1);
  await view.unmount(); expect(mockGuards.size).toBe(0); alert.mockRestore();
});
test('a failed native discard keeps the modal and its guard until an acknowledged retry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), discard = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await render(<WorkFlowBoundary><Editor discard={discard} /></WorkFlowBoundary>);
  await fireEvent.press(screen.getByRole('button', { name: '閉じる' }));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(mockRemoved).not.toHaveBeenCalled(); expect(mockGuards.size).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: '閉じる' }));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(discard).toHaveBeenCalledTimes(2); expect(mockRemoved).toHaveBeenCalledTimes(1); alert.mockRestore();
});

test('the compact header back and a native removal request preserve dirty input until discard is confirmed', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}), discard = jest.fn(async () => true);
  await render(<WorkFlowBoundary><Editor discard={discard} /></WorkFlowBoundary>);
  const back = screen.getByRole('button', { name: '前の画面に戻る' });
  expect(back).toHaveTextContent('‹');
  await fireEvent.press(back);
  expect(alert).toHaveBeenCalledTimes(1); expect(mockRemoved).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[0].onPress?.());
  expect(screen.getByText('input')).toBeTruthy(); expect(discard).not.toHaveBeenCalled();
  await act(async () => mockExit());
  expect(alert).toHaveBeenCalledTimes(2); expect(mockRemoved).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(discard).toHaveBeenCalledTimes(1); expect(mockRemoved).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
