import { nextTabFrame, productTabFromRoute, settledTabFrame, type TabFrame } from '../src/components/flow/product-tab-model';

function painted(frame: TabFrame, at: number) { return frame.starts.map((start, n) => start + (frame.ends[n] - start) * at); }
function fillsViewport(frame: TabFrame, at: number) {
  const positions = painted(frame, at);
  const ranges = positions.flatMap((x, n) => frame.visible[n] && x < 1 && x + 1 > 0 ? [[Math.max(0, x), Math.min(1, x + 1)]] : []).sort((a, b) => a[0] - b[0]);
  let until = 0;
  for (const [from, end] of ranges) { expect(from).toBeLessThanOrEqual(until + 1e-8); until = Math.max(until, end); }
  expect(until).toBeCloseTo(1);
}

test.each([[0, 1], [1, 2], [0, 2], [2, 1], [1, 0], [2, 0]])('tab %i → %i uses tab order, with no blank or intermediate page', (from, to) => {
  const frame = nextTabFrame(settledTabFrame(from), 1, to, true), direction = Math.sign(to - from);
  expect(frame.starts[to]).toBe(direction); expect(frame.ends[from]).toBe(-direction);
  expect(frame.fromTab).toBe(from); expect(frame.toTab).toBe(to);
  expect(frame.visible.flatMap((visible, n) => visible ? [n] : [])).toEqual([from, to].sort());
  for (const at of [0, 0.1, 0.4, 0.7, 1]) fillsViewport(frame, at);
});

test('rapid reversals preserve painted positions, cancel the old destination and fill the viewport', () => {
  for (const progress of [0, 0.2, 0.5, 0.9, 1]) for (const last of [0, 1]) {
    const first = nextTabFrame(settledTabFrame(0), 1, 2, true);
    const previous = painted(first, progress);
    const next = nextTabFrame(first, progress, last, true);
    expect(next.fromTab).toBeCloseTo(2 * progress); expect(next.toTab).toBe(last);
    for (const n of [0, 2]) if (Math.abs(previous[n]) < 0.99999) expect(next.starts[n]).toBeCloseTo(previous[n]);
    for (const at of [0, 0.1, 0.4, 0.8, 1]) fillsViewport(next, at);
    const final = nextTabFrame(next, 0.3, 2, true);
    for (const at of [0, 0.25, 0.6, 1]) fillsViewport(final, at);
  }
});

test('reduced motion/background finish immediately on the selected page, preserving URL mapping', () => {
  const moving = nextTabFrame(settledTabFrame(2), 1, 0, true);
  const stopped = nextTabFrame(moving, 0.4, 0, false);
  expect(stopped.animate).toBe(false); expect(stopped.fromTab).toBe(0); expect(stopped.toTab).toBe(0);
  expect(stopped.visible).toEqual([true, false, false]); fillsViewport(stopped, 1);
  expect(['index', 'reflection', 'settings'].map(productTabFromRoute)).toEqual(['home', 'reflection', 'settings']);
});
