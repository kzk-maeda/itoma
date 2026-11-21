import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SupportScreen } from '../src/components/flow/support';
import { observeSupport, supportRequest, type SupportPrice, type SupportReply } from '../modules/itoma-native/src/support';

jest.mock('../modules/itoma-native/src/support', () => ({ supportRequest: jest.fn(), observeSupport: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }));
jest.mock('../src/state/navigation', () => ({ useAppNavigation: () => ({ finish: jest.fn() }) }));
jest.mock('../src/state/screen-time', () => ({ useScreenTime: () => ({}) }));
jest.mock('../src/global.css', () => ({}));

const request = jest.mocked(supportRequest);
const price: SupportPrice = { id: 'test', display: '￥300', amount: '300', currency: 'JPY', storefront: '143462' };
const catalog: SupportReply = { state: 'idle', products: [price] };
let notify: () => void;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(observeSupport).mockImplementation(listener => { notify = listener; return { remove: jest.fn() }; });
  request.mockImplementation(async () => catalog);
});

const press = (name: string) => fireEvent.press(screen.getAllByRole('button', { name }).at(-1)!);

test('an amount and an explicit confirmation are required, a changed price requires a fresh choice', async () => {
  request.mockImplementation(async action => action === 'buy'
    ? { state: 'changed', products: [{ ...price, amount: '500', display: '￥500' }] } : catalog);
  await render(<SupportScreen />);
  await screen.findByRole('radio', { name: '￥300' });
  expect(screen.getByRole('button', { name: '支援内容を確認する' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('radio', { name: '￥300' }));
  await press('支援内容を確認する'); await press('金額の選択に戻る');
  expect(screen.getByRole('radio', { name: '￥300' })).toBeChecked();
  await press('支援内容を確認する'); await press('￥300の支援に進む');
  await screen.findByRole('radio', { name: '￥500' });
  expect(request).toHaveBeenCalledWith('buy', JSON.stringify(price));
  expect(screen.getByRole('button', { name: '支援内容を確認する' })).toBeDisabled();
});

test('a pending purchase completes asynchronously only on verified delivery', async () => {
  let result: SupportReply = { state: 'pending' };
  request.mockImplementation(async action => action === 'load' ? catalog : result);
  await render(<SupportScreen />);
  await fireEvent.press(await screen.findByRole('radio', { name: '￥300' }));
  await press('支援内容を確認する'); await press('￥300の支援に進む');
  await screen.findByText(/承認待ちです/);
  expect(screen.queryByText('ご支援ありがとうございます')).toBeNull();
  expect(screen.queryByText('支援内容を確認する')).toBeNull();
  result = { state: 'verified', receipt: 'Sandbox/123' };
  await act(async () => notify());
  expect(screen.getByText('ご支援ありがとうございます')).toBeOnTheScreen();
  await waitFor(() => expect(request).toHaveBeenCalledWith('ack', 'Sandbox/123'));
});

test('result retry queries the existing purchase and cannot initiate another charge', async () => {
  request.mockImplementation(async action => action === 'retry' ? { state: 'verified', receipt: 'Xcode/1' } : { state: 'unknown' });
  await render(<SupportScreen />);
  await screen.findByText('購入結果を確認し直す');
  await press('購入結果を確認し直す');
  await screen.findByText('ご支援ありがとうございます');
  expect(request.mock.calls.map(([action]) => action)).toEqual(['load', 'retry', 'ack']);
});

test('an unavailable catalog leaves the purchase path disabled and can reload', async () => {
  request.mockResolvedValueOnce({ state: 'empty', products: [] });
  await render(<SupportScreen />);
  await screen.findByText('現在、選べる支援額がありません。');
  expect(screen.queryByRole('radio')).toBeNull();
  await press('支援額を読み直す');
  await screen.findByRole('radio', { name: '￥300' });
});
