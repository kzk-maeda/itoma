// Presentation-only helpers for the Web study; these do not evaluate native rules.
export const HOUR = 3600000;
export const MINUTE = 60000;

export function sandLevels(fraction) {
  const remaining = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  // Equal-area trapezoidal bowls: 120px at the rim, 14px at the neck, 88px high.
  const height = 88, narrow = 14, wide = 120;
  const k = (wide - narrow) / (2 * height);
  const area = (wide + narrow) * height / 2;
  const upperHeight = (-narrow + Math.sqrt(narrow ** 2 + 4 * k * area * remaining)) / (2 * k);
  const lowerHeight = (wide - Math.sqrt(wide ** 2 - 4 * k * area * (1 - remaining))) / (2 * k);
  return { remaining, upperY:116 - upperHeight, lowerY:212 - lowerHeight };
}

export function remainingTime(expiresAt, now) { return Math.max(0, expiresAt - now); }

export function humanTime(milliseconds) {
  if (milliseconds <= 0) return '終了';
  if (milliseconds < MINUTE) return '1分未満';
  const minutes = Math.ceil(milliseconds / MINUTE), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}時間${rest ? rest + '分' : ''}` : `${rest}分`;
}

export function clockTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
