import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { appIconSVG } from '../assets/brand/render.mjs';

for (const [appearance, file] of [['light', 'icon'], ['dark', 'icon-dark']]) {
  const svg = appIconSVG(appearance);
  await writeFile(new URL(`../assets/brand/app-icon-${appearance}.svg`, import.meta.url), svg);
  await sharp(Buffer.from(svg)).toColourspace('srgb').removeAlpha().png()
    .toFile(fileURLToPath(new URL(`../assets/images/${file}.png`, import.meta.url)));
}
