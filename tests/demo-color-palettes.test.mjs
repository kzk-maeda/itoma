import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const scope = { window: {} };
runInNewContext(readFileSync(new URL('../public/color-palettes.js', import.meta.url), 'utf8'), scope);
const palettes = scope.window.itomaColorPalettes;

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

for (const palette of palettes) {
  for (const mode of ['light', 'dark']) {
    test(`${palette.id}/${mode}: actual text pairings meet 4.5:1`, () => {
      const colors = palette[mode];
      for (const color of Object.values(colors)) assert.match(color, /^#[0-9a-f]{6}$/i);
      // Includes the small status labels, purpose motif, selected options and filled buttons.
      for (const [foreground, background] of [
        ['text', 'bg'], ['text', 'surface'], ['text', 'soft'], ['text', 'warm'],
        ['muted', 'bg'], ['muted', 'surface'], ['muted', 'soft'],
        ['on', 'accent'], ['accent', 'soft'], ['warm-ink', 'warm'],
      ]) {
        const a = luminance(colors[foreground]);
        const b = luminance(colors[background]);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    });
  }
}
