import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomeScreen } from '../src/components/home/home-screen';

test('saves selected apps and discards canceled edits', async () => {
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '制限するアプリを選択' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'YouTube' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'X' }));
  await fireEvent.press(screen.getByRole('button', { name: '選択を反映' }));
  expect(screen.getByTestId('selected-apps-summary')).toHaveTextContent('YouTube・X');
  expect(screen.getByTestId('settings-feedback')).toHaveTextContent('アプリの選択を反映しました。');

  await fireEvent.press(screen.getByRole('button', { name: '制限するアプリを選択' }));
  expect(screen.getByRole('checkbox', { name: 'YouTube' })).toBeChecked();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'YouTube' }));
  await fireEvent.press(screen.getByRole('button', { name: '変更をキャンセル' }));
  expect(screen.getByTestId('selected-apps-summary')).toHaveTextContent('YouTube・X');

  await fireEvent.press(screen.getByRole('button', { name: '制限するアプリを選択' }));
  expect(screen.getByRole('checkbox', { name: 'YouTube' })).toBeChecked();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'YouTube' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'X' }));
  await fireEvent.press(screen.getByRole('button', { name: '選択を反映' }));
  expect(screen.getByTestId('selected-apps-summary')).toHaveTextContent('未選択');
});

test('saves a mode and keeps it when another choice is canceled', async () => {
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole('button', { name: '制限モードを設定' }));
  await fireEvent.press(screen.getByRole('radio', { name: /ひと呼吸/ }));
  await fireEvent.press(screen.getByRole('button', { name: '選択を反映' }));
  expect(screen.getByTestId('selected-mode-summary')).toHaveTextContent('ひと呼吸');

  await fireEvent.press(screen.getByRole('button', { name: '制限モードを設定' }));
  expect(screen.getByRole('radio', { name: /ひと呼吸/ })).toBeChecked();
  await fireEvent.press(screen.getByRole('radio', { name: /集中/ }));
  await fireEvent.press(screen.getByRole('button', { name: '変更をキャンセル' }));
  expect(screen.getByTestId('selected-mode-summary')).toHaveTextContent('ひと呼吸');
  expect(screen.getByTestId('settings-feedback')).toHaveTextContent('変更を反映せずに閉じました。');
  expect(screen.getByTestId('selected-apps-summary')).toHaveTextContent('未選択');
});
