jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../modules/itoma-native', () => ({
  itomaNative: { getAvailability: jest.fn(), validateDuration: jest.fn() },
  screenTimePoC: { run: jest.fn() }, reportNativeSmokeResult: jest.fn(),
  screenTime: { run: jest.fn() },
  historyRecords: { run: jest.fn() },
}));

const originalFlag = process.env.EXPO_PUBLIC_NATIVE_SMOKE;
const originalSHA = process.env.EXPO_PUBLIC_BUILD_SHA;
const commit = 'a'.repeat(40);
const response = { status: 'snapshot', snapshot: { availability: 'simulator-unavailable', authorization: 'unknown',
  storage: 'not-created', selections: [], observation: 'unknown', operation: 'idle', code: null } };

function setup() {
  const native = require('../modules/itoma-native');
  const { router } = require('expo-router');
  const qa = require('../src/qa/native-smoke');
  native.itomaNative.getAvailability.mockReturnValue({ status: 'available', apiVersion: 1, osRestrictions: 'unconnected' });
  native.itomaNative.validateDuration.mockImplementation((minutes: number) => minutes === 5
    ? { status: 'valid', minutes: 5 } : { status: 'invalid', code: 'invalid-duration' });
  native.screenTimePoC.run.mockResolvedValue(response);
  native.screenTime.run.mockResolvedValue({ status: 'error', code: 'unavailable', snapshot: { availability: 'simulator', storage: 'not-created', targets: [], observation: 'unknown' } });
  native.historyRecords.run.mockResolvedValue({ status: 'ok', storage: 'not-created' });
  return { native, router, qa };
}

beforeEach(() => {
  jest.resetModules();
  process.env.EXPO_PUBLIC_NATIVE_SMOKE = '1'; process.env.EXPO_PUBLIC_BUILD_SHA = commit;
});

test('missing product bridge proof cannot pass using the old PoC bridge alone', async () => {
  const { native, qa } = setup();
  native.screenTime.run.mockResolvedValue({ status: 'error', code: 'unavailable' });
  await qa.runNativeSmoke(); qa.completeNativePoCSmoke(response); qa.completeNativeHomeSmoke();
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, false);
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_NATIVE_SMOKE;
  else process.env.EXPO_PUBLIC_NATIVE_SMOKE = originalFlag;
  if (originalSHA === undefined) delete process.env.EXPO_PUBLIC_BUILD_SHA;
  else process.env.EXPO_PUBLIC_BUILD_SHA = originalSHA;
});

test('normal launches and malformed QA identities neither navigate nor signal', async () => {
  const { native, router, qa } = setup();
  delete process.env.EXPO_PUBLIC_NATIVE_SMOKE;
  await qa.runNativeSmoke(); qa.completeNativePoCSmoke(response); qa.completeNativeHomeSmoke();
  process.env.EXPO_PUBLIC_NATIVE_SMOKE = '1'; process.env.EXPO_PUBLIC_BUILD_SHA = 'main';
  await qa.runNativeSmoke();
  process.env.EXPO_PUBLIC_BUILD_SHA = `${commit}\n`; await qa.runNativeSmoke();
  expect(router.replace).not.toHaveBeenCalled();
  expect(native.screenTimePoC.run).not.toHaveBeenCalled();
  expect(native.reportNativeSmokeResult).not.toHaveBeenCalled();
});

test('bridge and PoC proof wait for the final home mount before emitting one pass', async () => {
  const { native, router, qa } = setup();
  qa.completeNativeHomeSmoke();
  await qa.runNativeSmoke();
  expect(router.replace).toHaveBeenCalledWith('/native-poc');
  expect(native.reportNativeSmokeResult).not.toHaveBeenCalled();
  qa.completeNativePoCSmoke(response); qa.completeNativePoCSmoke(response);
  expect(native.reportNativeSmokeResult).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenLastCalledWith('/history');
  qa.completeNativeHomeSmoke();
  expect(native.reportNativeSmokeResult).not.toHaveBeenCalled();
  qa.completeNativeHistorySmoke(true);
  expect(router.replace).toHaveBeenLastCalledWith('/');
  qa.completeNativeHomeSmoke(); qa.completeNativeHomeSmoke();
  await qa.runNativeSmoke();
  expect(native.reportNativeSmokeResult).toHaveBeenCalledTimes(1);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, true);
  expect(router.replace).toHaveBeenCalledTimes(3);
});

test.each([
  { status: 'error', code: 'native-error' },
  { ...response, snapshot: { ...response.snapshot, operation: 'failed', code: 'busy' } },
])('a destination snapshot failure cannot accept earlier bridge proof: %j', async (failure) => {
  const { native, qa } = setup();
  await qa.runNativeSmoke();
  qa.completeNativePoCSmoke(failure);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, false);
});

test('routing failure emits a safe failure and cannot complete later as a pass', async () => {
  const { native, router, qa } = setup();
  router.replace.mockImplementation(() => { throw new Error('navigation not mounted'); });
  await qa.runNativeSmoke(); qa.completeNativePoCSmoke(response);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledTimes(1);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, false);
});

test('failed or device-enabled bridge proof cannot navigate into a synthetic Simulator pass', async () => {
  const { native, router, qa } = setup();
  native.screenTimePoC.run.mockResolvedValue({ ...response, snapshot: { ...response.snapshot, availability: 'device-poc' } });
  await qa.runNativeSmoke(); qa.completeNativePoCSmoke(response);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledTimes(1);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, false);
  expect(router.replace).not.toHaveBeenCalled();
});

test('failure to return to home cannot be promoted by a later home callback', async () => {
  const { native, router, qa } = setup();
  router.replace.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('home unavailable'); });
  await qa.runNativeSmoke();
  qa.completeNativePoCSmoke(response); qa.completeNativeHomeSmoke();
  expect(native.reportNativeSmokeResult).toHaveBeenCalledTimes(1);
  expect(native.reportNativeSmokeResult).toHaveBeenCalledWith(commit, false);
});
