// Dates are handled as ISO strings ("YYYY-MM-DD") and integer UTC day numbers to avoid DST/timezone bugs.

const MS_DAY = 86400000;

export function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}
export function isoOf(n) {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}
export function addDays(iso, k) { return isoOf(dayNum(iso) + k); }
export function weekday(iso) { return new Date(dayNum(iso) * MS_DAY).getUTCDay(); } // 0=Sun
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mod = (a, n) => ((a % n) + n) % n;

// ---------- Rotation ----------
// Fairfax 24-hour rotation: 24 on / 24 off / 24 on / 24 off / 24 on / 4 days off (9-day cycle).
// The three shifts interleave so exactly one works each day. Verified against the user's anchors:
// Jan 5 2026 = A, Jan 6 = B, Jan 7 = C, Jan 8 = B.
export const ROTATION = 'ACABABCBC';
export const ROTATION_START = '2026-01-01';

export function shiftOn(iso, start = ROTATION_START) {
  return ROTATION[mod(dayNum(iso) - dayNum(start), ROTATION.length)];
}

// ---------- Periods ----------
/** Start (ISO) of the period of `len` days containing `iso`, aligned to `anchor`. */
export function periodStart(iso, anchor, len) {
  const a = dayNum(anchor);
  return isoOf(a + Math.floor((dayNum(iso) - a) / len) * len);
}
export const payPeriodStart = (iso, anchor) => periodStart(iso, anchor, 14);
export const flsaPeriodStart = (iso, anchor) => periodStart(iso, anchor, 28);

// ---------- Holidays (CBA Article 51) ----------
function nthWeekday(year, month, wd, n) { // month 1-12, n>=1
  const first = weekday(`${year}-${String(month).padStart(2, '0')}-01`);
  const day = 1 + mod(wd - first, 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function lastWeekday(year, month, wd) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const iso = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  return addDays(iso, -mod(weekday(iso) - wd, 7));
}

/** County holidays observed for bargaining-unit employees (CBA Art. 51), by actual date. */
export function holidaysForYear(year) {
  const f = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const list = [
    [f(1, 1), "New Year's Day"],
    [nthWeekday(year, 1, 1, 3), 'Martin Luther King Jr. Day'],
    [nthWeekday(year, 2, 1, 3), "Presidents' Day"],
    [lastWeekday(year, 5, 1), 'Memorial Day'],
    [f(6, 19), 'Juneteenth'],
    [f(7, 4), 'Independence Day'],
    [nthWeekday(year, 9, 1, 1), 'Labor Day'],
    [addDays(nthWeekday(year, 11, 1, 1), 1), 'Election Day'],
    [f(11, 11), "Veterans Day"],
    [thanksgiving, 'Thanksgiving Day'],
    [addDays(thanksgiving, 1), 'Day After Thanksgiving'],
    [f(12, 24), 'Christmas Eve'],
    [f(12, 25), 'Christmas Day'],
  ];
  // Inauguration Day: Jan 20 every fourth year (2029, 2033, ...) when it falls on a business day.
  if (year % 4 === 1) {
    const inaug = f(1, 20);
    const wd = weekday(inaug);
    if (wd >= 1 && wd <= 5) list.push([inaug, 'Inauguration Day']);
  }
  return list.map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Map of ISO → holiday name over a range of years, applying user edits. */
export function holidayMap(fromYear, toYear, custom = [], removed = []) {
  const map = new Map();
  for (let y = fromYear; y <= toYear; y++) for (const h of holidaysForYear(y)) map.set(h.date, h.name);
  for (const r of removed) map.delete(r);
  for (const c of custom) if (c.date) map.set(c.date, c.name || 'Holiday');
  return map;
}

// ---------- Formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtShort(iso) { const [, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; }
export function fmtDow(iso) { return DOW[weekday(iso)]; }
export function fmtLong(iso) { const [y] = iso.split('-'); return `${fmtDow(iso)}, ${fmtShort(iso)}, ${y}`; }
export function fmtMDY(iso) { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; }
