import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { supportsSavedSelectionUI } from '../modules/itoma-native';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const load = requireOptionalNativeModule as jest.Mock;
const originalOS = Platform.OS;
afterEach(() => { Platform.OS = originalOS; jest.clearAllMocks(); });

test.each([
  [null, false],
  [{ apiVersion: 1 }, false],
  [{ apiVersion: 1, screenTimePoCUIVersion: 1 }, false],
  [{ apiVersion: 1, screenTimePoCUIVersion: 2 }, true],
  [{ apiVersion: 1, screenTimePoCUIVersion: '2' }, false],
  [{ apiVersion: 2, screenTimePoCUIVersion: 2 }, false],
])('saved-target UI requires a compatible native build: %p', (native, supported) => {
  Platform.OS = 'ios'; load.mockReturnValue(native);
  expect(supportsSavedSelectionUI()).toBe(supported);
});

test('Web cannot load the native saved-target UI', () => {
  Platform.OS = 'web';
  expect(supportsSavedSelectionUI()).toBe(false);
  expect(load).not.toHaveBeenCalled();
});
