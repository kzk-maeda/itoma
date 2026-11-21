import identity from './identity.json' with { type: 'json' };

const { mark, wordmark, name, icon } = identity;
function path(d, color) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${mark.strokeWidth}" stroke-linecap="round" />`;
}

// Links and headings belong to the caller. The mark is decorative beside the readable name.
export const wordmarkHTML = `<span class="itoma-wordmark"><svg viewBox="${mark.viewBox}" aria-hidden="true">${path(mark.path, 'currentColor')}</svg><span>${name}</span></span>`;
export const wordmarkCSS = `.itoma-wordmark{display:inline-flex;align-items:center;gap:${wordmark.gap}px;font-family:system-ui,sans-serif;font-size:${wordmark.size / 16}rem;font-weight:${wordmark.weight};letter-spacing:${wordmark.tracking}px;white-space:nowrap}.itoma-wordmark svg{width:${wordmark.markSize / 16}rem;height:${wordmark.markSize / 16}rem;flex:none}`;

export function faviconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}"><rect width="40" height="40" rx="8" fill="${icon.light.background}"/>${path(mark.faviconPath, icon.light.ink)}</svg>\n`;
}

export function appIconSVG(appearance) {
  const { background, ink } = icon[appearance];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${background}" />
  <g transform="translate(112 112) scale(20)">
    ${path(mark.path, ink)}
  </g>
</svg>\n`;
}
