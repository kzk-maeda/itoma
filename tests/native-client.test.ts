import { createNativeClient } from '../modules/itoma-native/src/client';

test('unsupported platforms never try to load a native module; Expo Go absence is separate', () => {
  const load = jest.fn(() => null);
  expect(createNativeClient('web', load).getAvailability()).toEqual({ status: 'unavailable', reason: 'unsupported-platform' });
  expect(load).not.toHaveBeenCalled();
  expect(createNativeClient('ios', load).validateDuration(5)).toEqual({ status: 'unavailable', reason: 'module-missing' });
});

test('a missing method or incompatible API is not presented as native availability', () => {
  for (const port of [{ apiVersion: 2, validateDuration: jest.fn() }, { apiVersion: 1 }, 'wrong']) {
    expect(createNativeClient('ios', () => port).getAvailability()).toEqual({ status: 'unavailable', reason: 'incompatible-module' });
  }
});

test('native decides duration validity and availability never implies OS restrictions', () => {
  const validateDuration = jest.fn(() => ({ status: 'invalid', code: 'invalid-duration', minutes: null }));
  const client = createNativeClient('ios', () => ({ apiVersion: 1, validateDuration }));
  expect(client.getAvailability()).toEqual({ status: 'available', apiVersion: 1, osRestrictions: 'unconnected' });
  expect(client.validateDuration(17)).toEqual({ status: 'invalid', code: 'invalid-duration' });
  expect(validateDuration).toHaveBeenCalledWith(17); // No parallel TS rule implementation.
});

test('valid results must echo the same request and malformed payloads remain errors', () => {
  const validateDuration = jest.fn((minutes: number) => ({ status: 'valid', minutes, code: null }));
  const client = createNativeClient('ios', () => ({ apiVersion: 1, validateDuration }));
  expect(client.validateDuration(5)).toEqual({ status: 'valid', minutes: 5 });
  for (const value of [null, { status: 'valid', minutes: 10 }, { status: 'valid', minutes: '5' }, { status: 'invalid' }]) {
    const malformed = createNativeClient('ios', () => ({ apiVersion: 1, validateDuration: () => value }));
    expect(malformed.validateDuration(5)).toEqual({ status: 'error', code: 'invalid-response' });
  }
});

test('loader/native failures are safe errors, including an explicit native internal failure', () => {
  expect(createNativeClient('ios', () => { throw new Error('private detail'); }).getAvailability())
    .toEqual({ status: 'unavailable', reason: 'native-error' });
  for (const validateDuration of [() => { throw new Error('private detail'); }, () => ({ status: 'error', code: 'native-error' })]) {
    expect(createNativeClient('ios', () => ({ apiVersion: 1, validateDuration })).validateDuration(5))
      .toEqual({ status: 'error', code: 'native-error' });
  }
});
