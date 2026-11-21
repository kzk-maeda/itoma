import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { appIconSVG } from '../assets/brand/render.mjs';

for (const [appearance, file] of [['light', 'icon'], ['dark', 'icon-dark']]) {
  test(`${appearance} icon files match the brand source`, async () => {
    const svg = appIconSVG(appearance);
    assert.equal(await readFile(new URL(`../assets/brand/app-icon-${appearance}.svg`, import.meta.url), 'utf8'), svg);
    const image = fileURLToPath(new URL(`../assets/images/${file}.png`, import.meta.url));
    const pixels = input => sharp(input).toColourspace('srgb').removeAlpha().raw().toBuffer();
    assert.ok((await pixels(Buffer.from(svg))).equals(await pixels(image)), 'Regenerate the app icons with scripts/generate-brand-icons.mjs');
  });
}
