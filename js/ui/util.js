const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (n) => usd.format(Number(n) || 0);
export const money0 = (n) => usd0.format(Number(n) || 0);
export const hrs = (n) => `${Math.round((Number(n) || 0) * 10) / 10} h`;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function tierClass(tier) {
  if (tier === '2x') return 't2';
  if (tier === '1.5x') return 't15';
  if (tier === '1x') return 't1';
  return parseFloat(tier) >= 1.75 ? 't2' : 't15'; // blended tier, e.g. "1.75x"
}

/** Position a fixed element near an anchor rect, keeping it on screen. */
export function placeNear(elm, rect, gap = 6) {
  const w = elm.offsetWidth, h = elm.offsetHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  let top = rect.bottom + gap;
  if (top + h > innerHeight - 8) top = rect.top - h - gap;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  top = Math.max(8, top);
  elm.style.left = `${left}px`;
  elm.style.top = `${top}px`;
}

/** Get/set nested property by "a.b.c" path. */
export function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
export function setPath(obj, path, val) {
  const ks = path.split('.');
  const last = ks.pop();
  const tgt = ks.reduce((o, k) => (o[k] ??= {}), obj);
  tgt[last] = val;
}
