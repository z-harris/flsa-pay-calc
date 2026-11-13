import { paychecks, bestDays, rateOn, dayStatus } from '../payroll.js';
import { fmtShort, fmtMDY, todayISO, dayNum, isoOf } from '../schedule.js';
import { lookup } from '../payPlan.js';
import { esc, money, money0, hrs, $, placeNear } from './util.js';

export function computeChecks(app) {
  const { from, to } = app.range();
  return paychecks(app.ctx(), from, to);
}

export function renderKpis(app, checks) {
  const ctx = app.ctx();
  const { from, to } = app.range();
  const sum = (k) => checks.reduce((a, c) => a + c[k], 0);
  const today = todayISO();
  const open2x = bestDays(ctx, from > today ? from : today, to, { excludeAdjacent: true, only2x: true }).length;
  let leave = 0, lwop = 0, pus = 0, puH = 0;
  for (let n = dayNum(from); n <= dayNum(to); n++) {
    const st = dayStatus(ctx, isoOf(n));
    if (st.kind === 'LWOP') lwop += 24;
    else if (['AL', 'SL', 'CL'].includes(st.kind)) leave += 24;
    else if (st.kind === 'PU') { pus++; puH += Number(st.entry.hours) || 24; }
  }
  const p = app.state.profile;
  const rate = rateOn(app.state, today);
  const gs = p.rateOverride ? 'manual rate' : `${p.grade}-${p.step} ${lookup(p.grade, p.step)?.title || ''}`;
  const tile = (label, value, foot, cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
  $('#kpis').innerHTML = [
    tile('Est. gross', money0(sum('gross')), `${checks.length} paychecks in range`),
    tile('Est. take-home', money0(sum('net')), `after ${money0(sum('dedTotal'))} deductions`),
    tile('Hireback planned', money0(sum('otPay')), `${pus} pickup${pus === 1 ? '' : 's'} · ${puH} h`, 'accent'),
    tile('Open 2x days', open2x, 'not back-to-back, from today'),
    tile('Leave planned', hrs(leave), lwop ? `+ ${lwop} h without pay` : 'annual, sick & comp'),
    tile('Your hourly rate', money(rate.h3), esc(gs)),
  ].join('');
}

export function renderChart(app, checks) {
  const el = $('#chart');
  if (!checks.length) { el.innerHTML = ''; return; }
  const W = Math.max(320, el.clientWidth || 800), H = 220;
  const m = { l: 56, r: 8, t: 10, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(...checks.map((c) => c.gross), 1);
  const nice = niceMax(max);
  const y = (v) => m.t + ih - (v / nice) * ih;
  const bw = iw / checks.length;
  const barW = Math.max(3, Math.min(28, bw - 2));
  const ticks = [0, .25, .5, .75, 1].map((f) => f * nice);
  const every = Math.ceil(checks.length / Math.max(1, Math.floor(iw / 64)));
  const parts = [];
  for (const t of ticks) {
    parts.push(`<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`);
    parts.push(`<text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${money0(t)}</text>`);
  }
  checks.forEach((c, i) => {
    const x = m.l + i * bw + (bw - barW) / 2;
    const net = Math.max(0, c.net), ded = Math.max(0, c.gross - c.net);
    const yNet = y(net), yTop = y(net + ded);
    const gap = ded > 0 ? 2 : 0;
    const rad = Math.min(4, barW / 2);
    parts.push(`<g data-i="${i}">`);
    // Net segment (baseline-anchored); rounded top only when it is the top segment.
    parts.push(roundTop(x, yNet, barW, m.t + ih - yNet, ded > 0 ? 0 : rad, 'bar-net'));
    if (ded > 0) parts.push(roundTop(x, yTop, barW, Math.max(0, yNet - yTop - gap), rad, 'bar-ded'));
    parts.push('</g>');
    parts.push(`<rect class="hit" data-i="${i}" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${ih}"/>`);
    if (i % every === 0) parts.push(`<text class="axis" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${fmtShort(c.payDate)}</text>`);
  });
  el.innerHTML = `<div class="chart-legend"><span><i style="background:var(--series-1)"></i>Take-home</span><span><i style="background:var(--series-2)"></i>Deductions</span><span class="hint" style="margin:0">Bar height = gross · by pay date</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated gross pay per paycheck, split into take-home and deductions">${parts.join('')}</svg>`;
  const tip = $('#tooltip');
  el.onmousemove = (e) => {
    const h = e.target.closest('.hit');
    if (!h) { tip.hidden = true; return; }
    const c = checks[+h.dataset.i];
    tip.innerHTML = `<strong>Paid ${fmtMDY(c.payDate)}</strong><br>Gross ${money(c.gross)}<br>Deductions ${money(c.gross - c.net)}<br>Take-home ${money(c.net)}${c.otPay ? `<br>Hireback ${money(c.otPay)}` : ''}`;
    tip.hidden = false;
    placeNear(tip, { left: e.clientX, right: e.clientX, top: e.clientY - 12, bottom: e.clientY - 12, width: 0, height: 0 }, 14);
  };
  el.onmouseleave = () => { tip.hidden = true; };
}

function roundTop(x, y, w, h, r, cls) {
  if (h <= 0) return '';
  r = Math.min(r, h);
  return `<path class="${cls}" d="M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z"/>`;
}
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

const open = new Set();

const h0 = (n) => `${Math.round((Number(n) || 0) * 10) / 10}`;
const signed = (n) => (Math.abs(n) < 0.05 ? '—' : `${n > 0 ? '+' : '−'}${h0(Math.abs(n))}`);
const row = (label, value, cls = '') => `<div class="${cls}"><span>${label}</span><span>${value}</span></div>`;

function hoursDetail(c, r) {
  const h = c.hours;
  const shifts = h.sched / 24;
  const lines = [
    row(`Scheduled shifts (${shifts} × 24 h)`, hrs(h.sched)),
    h.worked !== h.sched ? row('&nbsp;&nbsp;worked', hrs(h.worked), 'sub') : '',
    h.leave ? row('&nbsp;&nbsp;on paid leave', hrs(h.leave), 'sub') : '',
    h.lwop ? row('&nbsp;&nbsp;leave without pay', hrs(h.lwop), 'sub') : '',
    h.lwop ? row('Leave without pay (not counted)', `−${hrs(h.lwop)}`) : '',
    h.leaveUncounted ? row('Paid leave (not counted toward OT)', `−${hrs(h.leaveUncounted)}`) : '',
    h.pickups ? row('Hireback worked this pay period', `+${hrs(h.pickups)}`) : '',
    row('Hours in this pay period', hrs(h.actual), 'total'),
    r.halfAdjust ? row(`Half adjustment${c.isSecondHalf ? ` (1st half fixed at ${r.halfTarget} h)` : ` (to ${r.halfTarget} h)`}${Math.abs(h.slide) >= 0.05 ? `, ${h.slide > 0 ? 'from' : 'to'} ${c.isSecondHalf ? '1st' : '2nd'} half` : ''}`, signed(h.slide) === '—' ? '0 h' : `${signed(h.slide)} h`) : '',
    row('Final FLSA hours on this check', hrs(h.final), 'total'),
    row('Net adjustment vs. scheduled', `${signed(h.adjust) === '—' ? '0' : signed(h.adjust)} h`),
  ];
  const where = [
    row('Period hours covered by this check', `${h0(h.periodFrom)}–${h0(h.periodTo)} of ${h0(h.periodTotal)} h`),
    row(`Straight time (up to ${r.t1} h)`, hrs(h.straight)),
    row(`${r.m1}x tier (${r.t1}–${r.t2} h)`, hrs(h.t15)),
    row(`${r.m2}x tier (over ${r.t2} h)`, hrs(h.t2)),
    row('Worked hours paid shift diff on this check', hrs(h.paidWorked)),
    row('Hireback hours paid on this check', hrs(h.paidPickups)),
  ];
  return [sect('Hours', lines.join('')), sect('Where the hours fall', where.join(''))].join('');
}
const sect = (title, body) => `<section><h4>${title}</h4>${body}</section>`;

export function renderTable(app, checks) {
  const t = $('#pay-table');
  const r = app.state.rules;
  const tot = (k) => checks.reduce((a, c) => a + c[k], 0);
  const totH = (k) => checks.reduce((a, c) => a + c.hours[k], 0);
  const COLS = 9;
  const rows = checks.map((c) => {
    const isOpen = open.has(c.start);
    const detail = isOpen ? `<tr class="detail"><td colspan="${COLS}"><div class="detail-grid">
        ${hoursDetail(c, r)}
        ${sect('Earnings', `
        ${row(`Base biweekly (${money(c.rate.annual)}/yr · ${money(c.rate.h3)}/h)`, money(c.base))}
        ${row(`Shift differential (${hrs(c.workedSched)} × ${money(r.shiftDiffOn ? r.shiftDiff : 0)})`, money(c.shiftDiff))}
        ${row('FLSA premium, scheduled hours', money(c.schedPrem))}
        ${row(`Hireback${c.h2 ? ` · ${h0(c.h2)} h @${r.m2}x` : ''}${c.h15 ? ` · ${h0(c.h15)} h @${r.m1}x` : ''}${c.h1 ? ` · ${h0(c.h1)} h @1x` : ''}`, money(c.otPay))}
        ${c.holidays.map((hl) => row(`Holiday: ${esc(hl.name)} (${hl.hours} h${hl.worked ? ', worked' : ''})`, money(hl.hours * c.rate.h3))).join('') || row('Holiday pay', money(0))}
        ${row(`ALS paramedic premium${app.state.profile.paramedic ? '' : ' (off)'}`, money(c.als))}
        ${row('Riding pay', money(c.riding))}
        ${row(`Leave without pay (${hrs(c.lwopH)})`, c.lwopDed ? `−${money(c.lwopDed)}` : money(0))}
        ${row('Gross', money(c.gross), 'total')}`)}
        ${sect('Deductions & net', `
        ${c.deds.map((d) => row(esc(d.name), `−${money(d.amount)}`)).join('') || row('None set — add them in Settings', '')}
        ${c.adjust ? row('Calibration adjustment', `${c.adjust > 0 ? '+' : '−'}${money(Math.abs(c.adjust))}`) : ''}
        ${row('Total deductions', `−${money(c.dedTotal - c.adjust)}`, 'total')}
        ${row('Net (take-home)', money(c.net), 'total')}`)}
        ${sect('Period', `
        ${row('Pay period', `${fmtMDY(c.start)} – ${fmtMDY(c.end)}`)}
        ${row('Pay date', fmtMDY(c.payDate))}
        ${row('28-day FLSA period starts', fmtMDY(c.flsaStart))}
        ${row('This check covers', `${c.isSecondHalf ? '2nd' : '1st'} half`)}`)}
      </div></td></tr>` : '';
    const h = c.hours;
    return `<tr class="main ${isOpen ? 'open' : ''}" data-k="${c.start}" tabindex="0" aria-expanded="${isOpen}">
      <td><span class="caret">▸</span>${fmtMDY(c.payDate)}</td>
      <td>${fmtShort(c.start)} – ${fmtShort(c.end)}</td>
      <td>${h0(h.sched)}</td>
      <td class="${h.adjust > 0 ? 'adj-up' : h.adjust < 0 ? 'adj-down' : ''}" title="LWOP, hireback${r.halfAdjust ? ' and first-half adjustment' : ''}">${signed(h.adjust)}</td>
      <td><strong>${h0(h.final)}</strong></td>
      <td>${money(c.base)}</td>
      <td><strong>${money(c.gross)}</strong></td><td>−${money(c.dedTotal - c.adjust)}</td><td class="net">${money(c.net)}</td>
    </tr>${detail}`;
  }).join('');
  t.innerHTML = `<thead><tr><th>Pay date</th><th>Pay period</th><th>Sched. h</th><th>Adj. h</th><th>Final h</th><th>Base</th><th>Gross</th><th>Deductions</th><th>Net</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${checks.length} checks</td><td>${h0(totH('sched'))}</td><td>${signed(totH('adjust'))}</td><td>${h0(totH('final'))}</td>
    <td>${money(tot('base'))}</td><td>${money(tot('gross'))}</td><td>−${money(tot('dedTotal') - tot('adjust'))}</td><td class="net">${money(tot('net'))}</td></tr></tfoot>`;
  const toggle = (tr) => {
    const k = tr.dataset.k;
    if (open.has(k)) open.delete(k); else open.add(k);
    renderTable(app, checks);
    $(`#pay-table tr[data-k="${k}"]`)?.focus();
  };
  t.onclick = (e) => { const tr = e.target.closest('tr.main'); if (tr) toggle(tr); };
  t.onkeydown = (e) => { const tr = e.target.closest('tr.main'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(tr); } };
  $('#pay-hint').textContent = `Pay date = period end + ${app.state.anchors.paydayOffset} days. ${r.halfAdjust ? `First-half checks count ${r.halfTarget} h; the rest (and overtime) slides to the second-half check.` : `Overtime is paid ${r.otTiming === 'byDate' ? 'in the pay period worked' : 'on the check after each 28-day period closes'}.`} Adj. h = leave without pay, hireback${r.halfAdjust ? ' and the first-half adjustment' : ''}. Click a row for the full breakdown.`;
}
