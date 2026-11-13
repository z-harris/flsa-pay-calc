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

export function renderTable(app, checks) {
  const t = $('#pay-table');
  const tot = (k) => checks.reduce((a, c) => a + c[k], 0);
  const other = (c) => c.als + c.riding - c.lwopDed;
  const otH = (c) => c.h1 + c.h15 + c.h2;
  const rows = checks.map((c, i) => {
    const isOpen = open.has(c.start);
    const detail = isOpen ? `<tr class="detail"><td colspan="11"><div class="detail-grid">
        <h4>Earnings</h4>
        <div><span>Base biweekly (${money(c.rate.annual)}/yr)</span><span>${money(c.base)}</span></div>
        <div><span>Shift differential (${c.workedSched} h worked)</span><span>${money(c.shiftDiff)}</span></div>
        <div><span>FLSA premium, scheduled hours</span><span>${money(c.schedPrem)}</span></div>
        <div><span>Hireback ${c.h2 ? `${c.h2} h @2x ` : ''}${c.h15 ? `${c.h15} h @1.5x ` : ''}${c.h1 ? `${c.h1} h @1x` : ''}</span><span>${money(c.otPay)}</span></div>
        ${c.holidays.map((h) => `<div><span>Holiday: ${esc(h.name)} (${h.hours} h${h.worked ? ', worked' : ''})</span><span>${money(h.hours * c.rate.h3)}</span></div>`).join('')}
        ${c.als ? `<div><span>ALS paramedic premium</span><span>${money(c.als)}</span></div>` : ''}
        ${c.riding ? `<div><span>Riding pay</span><span>${money(c.riding)}</span></div>` : ''}
        ${c.lwopDed ? `<div><span>Leave without pay (${c.lwopH} h)</span><span>−${money(c.lwopDed)}</span></div>` : ''}
        ${c.leaveH ? `<div><span>Paid leave used</span><span>${c.leaveH} h</span></div>` : ''}
        <h4>Deductions</h4>
        ${c.deds.map((d) => `<div><span>${esc(d.name)}</span><span>−${money(d.amount)}</span></div>`).join('') || '<div><span>None set — add them in Settings</span><span></span></div>'}
        ${c.adjust ? `<div><span>Calibration adjustment</span><span>${c.adjust > 0 ? '+' : '−'}${money(Math.abs(c.adjust))}</span></div>` : ''}
        <h4>Period</h4>
        <div><span>Pay period</span><span>${fmtMDY(c.start)} – ${fmtMDY(c.end)}</span></div>
        ${c.hoursCounted !== null ? `<div><span>FLSA hours on this check${c.hoursCounted !== c.hoursActual ? ` (${c.hoursActual} h in period, ${c.hoursCounted > c.hoursActual ? 'pulled' : 'slid'} ${Math.abs(c.hoursCounted - c.hoursActual)} h ${c.isSecondHalf ? (c.hoursCounted > c.hoursActual ? 'from 1st half' : 'to 1st half') : (c.hoursCounted > c.hoursActual ? 'from 2nd half' : 'to 2nd half')})` : ''}</span><span>${c.hoursCounted} h</span></div>` : ''}
        <div><span>28-day FLSA period starts</span><span>${fmtMDY(c.flsaStart)} (${c.isSecondHalf ? '2nd' : '1st'} half)</span></div>
      </div></td></tr>` : '';
    return `<tr class="main ${isOpen ? 'open' : ''}" data-k="${c.start}" tabindex="0" aria-expanded="${isOpen}">
      <td><span class="caret">▸</span>${fmtMDY(c.payDate)}</td>
      <td>${fmtShort(c.start)} – ${fmtShort(c.end)}</td>
      <td>${money(c.base)}</td><td>${money(c.shiftDiff)}</td><td>${money(c.schedPrem)}</td>
      <td class="${c.otPay ? 'ot' : ''}">${otH(c) ? `${otH(c)} h · ` : ''}${money(c.otPay)}</td>
      <td>${money(c.holidayPay)}</td><td>${money(other(c))}</td>
      <td><strong>${money(c.gross)}</strong></td><td>−${money(c.dedTotal - c.adjust)}</td><td class="net">${money(c.net)}</td>
    </tr>${detail}`;
  }).join('');
  t.innerHTML = `<thead><tr><th>Pay date</th><th>Pay period</th><th>Base</th><th>Shift diff</th><th>FLSA prem.</th><th>Hireback</th><th>Holiday</th><th>Other</th><th>Gross</th><th>Deductions</th><th>Net</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td>${checks.length} checks</td><td>${money(tot('base'))}</td><td>${money(tot('shiftDiff'))}</td><td>${money(tot('schedPrem'))}</td>
    <td>${money(tot('otPay'))}</td><td>${money(tot('holidayPay'))}</td><td>${money(checks.reduce((a, c) => a + other(c), 0))}</td>
    <td>${money(tot('gross'))}</td><td>−${money(tot('dedTotal') - tot('adjust'))}</td><td class="net">${money(tot('net'))}</td></tr></tfoot>`;
  const toggle = (tr) => {
    const k = tr.dataset.k;
    if (open.has(k)) open.delete(k); else open.add(k);
    renderTable(app, checks);
    $(`#pay-table tr[data-k="${k}"]`)?.focus();
  };
  t.onclick = (e) => { const tr = e.target.closest('tr.main'); if (tr) toggle(tr); };
  t.onkeydown = (e) => { const tr = e.target.closest('tr.main'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(tr); } };
  const r = app.state.rules;
  $('#pay-hint').textContent = `Pay date = period end + ${app.state.anchors.paydayOffset} days. ${r.halfAdjust ? `First-half checks count ${r.halfTarget} h; the rest (and overtime) slides to the second-half check.` : `Overtime is paid ${r.otTiming === 'byDate' ? 'in the pay period worked' : 'on the check after each 28-day period closes'}.`} Click a row for details.`;
}
