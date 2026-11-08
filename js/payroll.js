// Pay engine: FLSA 28-day tallies, OT tiers, marginal pickup value, biweekly paychecks.
import { lookup, ratesFromAnnual, PLAN_NEXT_FY, MAX_STEP } from './payPlan.js';
import { dayNum, isoOf, addDays, shiftOn, payPeriodStart, flsaPeriodStart, holidayMap } from './schedule.js';

export const LEAVE_TYPES = {
  AL: { label: 'Annual leave', short: 'AL', paid: true },
  SL: { label: 'Sick leave', short: 'SL', paid: true },
  CL: { label: 'Comp leave', short: 'CL', paid: true },
  LWOP: { label: 'Leave without pay', short: 'LWOP', paid: false },
};

export const DEFAULT_STATE = () => ({
  v: 1,
  onboarded: false,
  theme: 'auto',
  profile: {
    name: '', shift: 'A', grade: 'F18', step: 1,
    rateOverride: null,      // manual 24-hr hourly rate; overrides grade/step
    nextStepDate: '',        // optional: step increases by 1 on this date
    raisePct: 0,             // assumed scale raise from FY2028 (CBA ends 2027-06-30)
    paramedic: false, alsPct: 10,   // CBA §75.2
    ridingRate: 0,           // CBA §75.3: $3/hr ALS transport lead, $2/hr non-transport lead
  },
  view: { months: 12, start: '' },
  rules: {
    t1: 212, m1: 1.5,              // Regs §4.12: FLSA OT over 212 h / 28 days (verified)
    t2: 240, m2: 2.0,              // user-reported: 2x over 240 h (verify)
    leaveCounts: true,             // Regs: "hours worked or on paid leave" count toward 212
    regRateIncludesDiff: true,     // Regs Ch. 2 "Regular Rate of Pay" includes shift differential
    scheduledPremium: true,        // FLSA premium on scheduled hours above 212 (verify against stub)
    shiftDiffOn: true, shiftDiff: 0.7275, // CBA §75.5A
    holidayWorked: 16, holidayOff: 11.2,  // 11.2 = 0.1 × 112 biweekly hrs (Regs §4.12-3a); 16 user-reported
    otTiming: 'periodEnd',         // 'periodEnd' | 'byDate'
  },
  anchors: { payPeriod: '2026-07-11', flsaOffset: 0, paydayOffset: 7 },
  days: {},                // ISO → { type: 'AL'|'SL'|'CL'|'LWOP'|'PU', hours }
  holidaysCustom: [], holidaysRemoved: [],
  deductions: [
    { id: 'urs', name: 'Uniformed Retirement (URS)', type: 'pctBase', value: 7.08, on: true },
    { id: 'ss', name: 'Social Security (if applicable)', type: 'pctGross', value: 6.2, on: true },
    { id: 'med', name: 'Medicare', type: 'pctGross', value: 1.45, on: true },
    { id: 'fed', name: 'Federal income tax (est.)', type: 'pctGross', value: 10, on: true },
    { id: 'va', name: 'Virginia income tax (est.)', type: 'pctGross', value: 4.5, on: true },
    { id: 'health', name: 'Health insurance', type: 'fixed', value: 0, on: false },
    { id: 'dental', name: 'Dental / vision', type: 'fixed', value: 0, on: false },
    { id: 'def', name: '457(b) deferred comp', type: 'pctGross', value: 0, on: false },
    { id: 'union', name: 'Union dues', type: 'fixed', value: 0, on: false },
  ],
  calib: { adjust: 0, payDate: '', actual: null },
});

const r2 = (n) => Math.round(n * 100) / 100;

// ---------- Rates ----------
export function rateOn(state, iso) {
  const p = state.profile;
  let annual;
  if (p.rateOverride && p.rateOverride > 0) {
    annual = p.rateOverride * 2912;
  } else {
    let step = p.step;
    if (p.nextStepDate && iso >= p.nextStepDate) step = Math.min(MAX_STEP, step + 1);
    const l = lookup(p.grade, step);
    if (!l) return ratesFromAnnual(0);
    annual = l.annual;
    if (p.raisePct && iso >= PLAN_NEXT_FY) annual *= 1 + p.raisePct / 100;
  }
  return ratesFromAnnual(annual);
}

// ---------- Day classification ----------
export function makeCtx(state) {
  const pay = state.anchors.payPeriod;
  const flsa = addDays(pay, state.anchors.flsaOffset ? 14 : 0);
  const y = new Date().getFullYear();
  const holidays = holidayMap(y - 1, y + 3, state.holidaysCustom, state.holidaysRemoved);
  return { state, pay, flsa, holidays, periodCache: new Map() };
}

export function dayStatus(ctx, iso) {
  const s = ctx.state;
  const shift = shiftOn(iso);
  const mine = shift === s.profile.shift;
  const entry = s.days[iso] || null;
  let kind;
  if (mine) kind = entry && LEAVE_TYPES[entry.type] ? entry.type : 'WORK';
  else kind = entry && entry.type === 'PU' ? 'PU' : 'OFF';
  return { iso, shift, mine, kind, entry, holiday: ctx.holidays.get(iso) || null };
}

const isWorkingOwn = (ctx, iso) => dayStatus(ctx, iso).kind === 'WORK';
const isPickup = (ctx, iso) => dayStatus(ctx, iso).kind === 'PU';

// ---------- Tier math ----------
/** Split hour interval [a, b) into the three FLSA tiers. */
export function splitTiers(a, b, r) {
  const seg = (lo, hi) => Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  return { h1: seg(-Infinity, r.t1), h15: seg(r.t1, r.t2), h2: seg(r.t2, Infinity) };
}

function otRate(ctx, iso) {
  const r = ctx.state.rules;
  return rateOn(ctx.state, iso).h3 + (r.regRateIncludesDiff && r.shiftDiffOn ? r.shiftDiff : 0);
}

// ---------- FLSA 28-day period ----------
export function flsaPeriod(ctx, iso) {
  const start = flsaPeriodStart(iso, ctx.flsa);
  if (ctx.periodCache.has(start)) return ctx.periodCache.get(start);
  const r = ctx.state.rules;
  let sched = 0, leave = 0, lwop = 0;
  const pickups = [];
  for (let i = 0; i < 28; i++) {
    const d = addDays(start, i);
    const st = dayStatus(ctx, d);
    if (st.mine) {
      sched += 24;
      if (st.kind === 'LWOP') lwop += 24;
      else if (st.kind !== 'WORK') leave += 24;
    } else if (st.kind === 'PU') {
      pickups.push({ date: d, hours: Math.max(0, Number(st.entry.hours) || 24) });
    }
  }
  const workedSched = sched - leave - lwop;
  const baseCounted = workedSched + (r.leaveCounts ? leave : 0);
  const rate = otRate(ctx, start);
  const prem = splitTiers(0, baseCounted, r);
  const schedPremium = r.scheduledPremium ? (prem.h15 * (r.m1 - 1) + prem.h2 * (r.m2 - 1)) * rate : 0;
  let cursor = baseCounted;
  for (const p of pickups) {
    const t = splitTiers(cursor, cursor + p.hours, r);
    Object.assign(p, t, { pay: (t.h1 + t.h15 * r.m1 + t.h2 * r.m2) * rate });
    cursor += p.hours;
  }
  const period = {
    start, end: addDays(start, 27), sched, leave, lwop, workedSched, baseCounted,
    counted: cursor, pickups, rate, schedPremium, premHours: prem,
  };
  ctx.periodCache.set(start, period);
  return period;
}

/** Value of adding `hours` of hireback on top of the period's current total. */
export function marginal(ctx, iso, hours = 24) {
  const r = ctx.state.rules;
  const p = flsaPeriod(ctx, iso);
  const t = splitTiers(p.counted, p.counted + hours, r);
  const pay = (t.h1 + t.h15 * r.m1 + t.h2 * r.m2) * p.rate + hours * (ctx.state.profile.ridingRate || 0);
  let tier;
  if (t.h2 === hours) tier = '2x';
  else if (t.h15 === hours) tier = '1.5x';
  else if (t.h1 === hours) tier = '1x';
  else tier = `${Math.round(((t.h1 + t.h15 * r.m1 + t.h2 * r.m2) / hours) * 100) / 100}x`;
  return { ...t, pay, tier, period: p, effMult: pay / (hours * rateOn(ctx.state, iso).h3) };
}

// ---------- Best days ----------
export function bestDays(ctx, from, to, { excludeAdjacent = true, only2x = false, month = '' } = {}) {
  const out = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) {
    const d = isoOf(n);
    const st = dayStatus(ctx, d);
    if (st.mine || st.kind === 'PU') continue;
    if (month && d.slice(0, 7) !== month) continue;
    const prev = addDays(d, -1), next = addDays(d, 1);
    const adjOwn = isWorkingOwn(ctx, prev) || isWorkingOwn(ctx, next);
    const adjPU = isPickup(ctx, prev) || isPickup(ctx, next);
    const adjacent = adjOwn || adjPU;
    if (excludeAdjacent && adjacent) continue;
    const m = marginal(ctx, d, 24);
    if (only2x && m.tier !== '2x') continue;
    out.push({ date: d, ...m, adjacent, adjOwn, adjPU, holiday: st.holiday });
  }
  out.sort((a, b) => b.pay - a.pay || a.date.localeCompare(b.date));
  return out;
}

// ---------- Paychecks ----------
export function paycheck(ctx, ppStart) {
  const s = ctx.state, r = s.rules, p = s.profile;
  const rate = rateOn(s, ppStart);
  let workedSched = 0, lwopH = 0, leaveH = 0, puHours = 0, holidayPay = 0;
  const holidays = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(ppStart, i);
    const st = dayStatus(ctx, d);
    if (st.mine) {
      if (st.kind === 'WORK') workedSched += 24;
      else if (st.kind === 'LWOP') lwopH += 24;
      else leaveH += 24;
    } else if (st.kind === 'PU') puHours += Number(st.entry.hours) || 24;
    if (st.holiday && st.kind !== 'LWOP') {
      const h = st.kind === 'WORK' ? r.holidayWorked : r.holidayOff;
      holidayPay += h * rate.h3;
      holidays.push({ date: d, name: st.holiday, hours: h, worked: st.kind === 'WORK' });
    }
  }
  const base = rate.biweekly;
  const lwopDed = lwopH * rate.h3;
  const shiftDiff = r.shiftDiffOn ? workedSched * r.shiftDiff : 0;
  const riding = (p.ridingRate || 0) * (workedSched + puHours);
  const als = p.paramedic ? base * (p.alsPct || 0) / 100 : 0;

  // Overtime attribution from the FLSA period(s) touching this pay period.
  const fp = flsaPeriod(ctx, ppStart);
  const isSecondHalf = dayNum(ppStart) - dayNum(fp.start) === 14;
  let schedPrem = 0, otPay = 0, h15 = 0, h2 = 0, h1 = 0;
  const end = addDays(ppStart, 13);
  if (r.otTiming === 'byDate') {
    schedPrem = fp.schedPremium / 2;
    for (const pu of fp.pickups) if (pu.date >= ppStart && pu.date <= end) { otPay += pu.pay; h1 += pu.h1; h15 += pu.h15; h2 += pu.h2; }
  } else if (isSecondHalf) {
    schedPrem = fp.schedPremium;
    for (const pu of fp.pickups) { otPay += pu.pay; h1 += pu.h1; h15 += pu.h15; h2 += pu.h2; }
  }

  const gross = base - lwopDed + shiftDiff + holidayPay + riding + als + schedPrem + otPay;
  const baseNet = base - lwopDed;
  const deds = s.deductions.filter((d) => d.on && Number(d.value)).map((d) => {
    const v = Number(d.value);
    const amt = d.type === 'fixed' ? v : d.type === 'pctBase' ? baseNet * v / 100 : gross * v / 100;
    return { name: d.name, amount: r2(amt) };
  });
  const dedTotal = deds.reduce((a, d) => a + d.amount, 0);
  const adjust = Number(s.calib.adjust) || 0;
  const netRaw = gross - dedTotal;
  return {
    start: ppStart, end, payDate: addDays(end, Number(s.anchors.paydayOffset) || 0),
    flsaStart: fp.start, isSecondHalf,
    rate, base: r2(base), lwopDed: r2(lwopDed), shiftDiff: r2(shiftDiff), holidayPay: r2(holidayPay), holidays,
    riding: r2(riding), als: r2(als), schedPrem: r2(schedPrem), otPay: r2(otPay), h1, h15, h2,
    workedSched, leaveH, lwopH, puHours,
    gross: r2(gross), deds, dedTotal: r2(dedTotal), adjust: r2(adjust), netRaw: r2(netRaw), net: r2(netRaw + adjust),
  };
}

/** Paychecks for every pay period that overlaps [from, to]. */
export function paychecks(ctx, from, to) {
  const out = [];
  for (let st = payPeriodStart(from, ctx.pay); st <= to; st = addDays(st, 14)) out.push(paycheck(ctx, st));
  return out;
}

/** Greedy "plan top N": add the N best pickups one at a time (re-ranking after each). */
export function planTopN(state, from, to, n, opts) {
  const added = [];
  for (let i = 0; i < n; i++) {
    const ctx = makeCtx(state);
    const list = bestDays(ctx, from, to, { ...opts, excludeAdjacent: true });
    if (!list.length) break;
    state.days[list[0].date] = { type: 'PU', hours: 24 };
    added.push(list[0].date);
  }
  return added;
}
