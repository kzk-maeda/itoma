import { useState } from 'react';
import { View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApplicationChoice } from '../src/components/flow/application-choice';
import { ApplicationLabels, ApplicationSymbols } from '../src/runtime/application-labels';
jest.mock('../src/global.css', () => ({}));
let mockNativeProps: Record<string, unknown> | undefined;
jest.mock('expo-modules-core', () => ({ ...jest.requireActual('expo-modules-core'), requireNativeViewManager: () => (props: Record<string, unknown>) => {
  mockNativeProps = props;
  return require('react').createElement(require('react-native').Text, null, 'Appleが表示するアプリ');
} }));

function Choices() {
  const [selected, select] = useState('');
  return <ApplicationLabels.Provider value={(_, target) => target.toUpperCase()}>
    <ApplicationSymbols.Provider value={(_, target) => target === 'x' ? '𝕏' : '▶'}>
      <View accessibilityRole="radiogroup" accessibilityLabel="解除するアプリ">
        {['x', 'youtube', 'blocked'].map(target => <ApplicationChoice key={target} selectionRef="sample" targetRef={target} refreshKey={0}
          selected={selected === target} disabled={target === 'blocked'} detail={selected === target ? '選択中' : target === 'blocked' ? '現在、一時解除できません。' : 'タップして選択'} onSelect={() => select(target)} />)}
      </View>
    </ApplicationSymbols.Provider>
  </ApplicationLabels.Provider>;
}

test('shared row exposes unchecked radios, selects from its detail or indicator and keeps a single choice', async () => {
  await render(<Choices />);
  expect(screen.getByRole('radio', { name: 'X' })).not.toBeChecked();
  expect(screen.getByTestId('application-choice-indicator-x', { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.press(screen.getAllByText('タップして選択')[0]);
  expect(screen.getByRole('radio', { name: 'X' })).toBeChecked();
  expect(screen.getByText('選択中')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('application-choice-indicator-youtube', { includeHiddenElements: true }));
  expect(screen.getByRole('radio', { name: 'X' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'YOUTUBE' })).toBeChecked();
  await fireEvent.press(screen.getByRole('radio', { name: 'BLOCKED' }));
  expect(screen.getByRole('radio', { name: 'BLOCKED' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'BLOCKED' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'YOUTUBE' })).toBeChecked();
});

test('native identity stays display-only; the shared outer row owns a single selection callback', async () => {
  const select = jest.fn();
  await render(<ApplicationChoice selectionRef="opaque-selection" targetRef="opaque-target" refreshKey={0} selected={false} disabled={false} detail="タップして選択" onSelect={select} />);
  expect(mockNativeProps).toMatchObject({ source: 'product', selectable: false, selected: false });
  expect(mockNativeProps?.onSelect).toBeUndefined();
  await fireEvent.press(screen.getByText('Appleが表示するアプリ'));
  expect(select).toHaveBeenCalledTimes(1);
});
