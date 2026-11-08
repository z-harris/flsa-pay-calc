import { dayNum, isoOf, addDays, weekday, todayISO, fmtLong, fmtShort, MONTH_NAMES, flsaPeriodStart } from '../schedule.js';
import { dayStatus, flsaPeriod, marginal, LEAVE_TYPES } from '../payroll.js';
import { esc, money0, tierClass, placeNear, $, $$ } from './util.js';

export function renderLegend(app) {
  const s = app.state.profile.shift;
  $('#legend').innerHTML = `
    <span><i class="sw mine"></i>Your shift (${s})</span>
    <span><i class="sw t2"></i>Pickup pays 2x</span>
    <span><i class="sw t15"></i>Pickup pays 1.5x</span>
    <span><i class="sw pu"></i>Planned pickup</span>
    <span><i class="sw leave"></i>Leave</span>
    <span><i class="dot-h"></i>Holiday</span>`;
}

export function renderPeriods(app) {
  const { from, to } = app.range();
  const ctx = app.ctx();
  const r = app.state.rules;
  const out = [];
  for (let st = flsaPeriodStart(from, ctx.flsa); st <= to; st = addDays(st, 28)) {
    const p = flsaPeriod(ctx, st);
    const m = marginal(ctx, st, 24);
    const max = Math.max(r.t2 + 48, p.counted + 24);
    const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
    out.push(`
      <button class="pchip" data-period="${st}" title="28-day FLSA work period">
        <span class="pd">${fmtShort(p.start)} – ${fmtShort(p.end)}</span>
        <span class="ph"><strong>${p.counted} h</strong> <span class="hint" style="margin:0">(${p.sched} scheduled)</span></span>
        <span class="meter" aria-hidden="true"><i style="width:${pct(p.counted)}"></i><b style="left:${pct(r.t1)}"></b><b style="left:${pct(r.t2)}"></b></span>
        <span class="ph">Next pickup <span class="tierchip ${tierClass(m.tier)}">${m.tier}</span> ${money0(m.pay)}</span>
      </button>`);
  }
  const el = $('#periods');
  el.innerHTML = out.join('');
  el.onmouseover = el.onfocusin = (e) => highlight(e.target.closest('.pchip')?.dataset.period);
  el.onmouseleave = el.onfocusout = () => highlight(null);
}

function highlight(start) {
  $$('.day.hl').forEach((d) => d.classList.remove('hl'));
  if (!start) return;
  $$(`.day[data-p="${start}"]`).forEach((d) => d.classList.add('hl'));
}

export function renderCalendar(app) {
  const { from, months } = app.range();
  const ctx = app.ctx();
  const today = todayISO();
  const [y0, m0] = from.split('-').map(Number);
  const html = [];
  for (let k = 0; k < months; k++) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12);
    const m = ((m0 - 1 + k) % 12) + 1;
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let shifts = 0, pus = 0;
    const cells = [];
    for (let i = 0; i < weekday(first); i++) cells.push('<span class="day blank" aria-hidden="true"></span>');
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(dayNum(first) + d - 1);
      const st = dayStatus(ctx, iso);
      const pStart = flsaPeriodStart(iso, ctx.flsa);
      const cls = ['day'];
      let tag = '', label = `${fmtLong(iso)}. ${st.shift} shift`;
      if (st.mine) {
        shifts++;
        cls.push('mine');
        if (st.kind === 'WORK') { tag = 'ON'; label += ', your shift'; }
        else if (st.kind === 'LWOP') { cls.push('lwop'); tag = 'LWOP'; label += ', leave without pay'; }
        else { cls.push('leave'); tag = st.kind; label += `, ${LEAVE_TYPES[st.kind].label}`; }
      } else if (st.kind === 'PU') {
        pus++;
        cls.push('pu');
        const h = Number(st.entry.hours) || 24;
        tag = `+${h}h`; label += `, planned pickup ${h} hours`;
      } else if (iso >= today) {
        const mg = marginal(ctx, iso, 24);
        if (mg.tier !== '1x') cls.push(tierClass(mg.tier));
        tag = mg.tier === '1x' ? '' : mg.tier;
        label += `, off. Pickup would pay ${money0(mg.pay)} (${mg.tier})`;
      } else label += ', off';
      if (iso < today) cls.push('past');
      if (iso === today) cls.push('today');
      if (iso === pStart) { cls.push('pstart'); label += '. Start of 28-day FLSA period'; }
      if (st.holiday) label += `. Holiday: ${st.holiday}`;
      cells.push(`<button class="${cls.join(' ')}" data-date="${iso}" data-p="${pStart}" aria-label="${esc(label)}" title="${esc(st.holiday || '')}">
        <span class="dn">${d}</span><span class="sh" aria-hidden="true">${st.shift}</span>
        <span class="tag" aria-hidden="true">${tag}</span>${st.holiday ? '<span class="hol" aria-hidden="true"></span>' : ''}
      </button>`);
    }
    html.push(`<div class="month">
      <h3>${MONTH_NAMES[m - 1]} ${y}<small>${shifts} shifts${pus ? ` · ${pus} pickup${pus > 1 ? 's' : ''}` : ''}</small></h3>
      <div class="grid7">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span class="dow" aria-hidden="true">${x}</span>`).join('')}${cells.join('')}</div>
    </div>`);
  }
  const cal = $('#calendar');
  cal.innerHTML = html.join('');
  cal.onclick = (e) => {
    const b = e.target.closest('.day[data-date]');
    if (b) openDayMenu(app, b.dataset.date, b);
  };
  cal.onkeydown = (e) => {
    const b = e.target.closest('.day[data-date]');
    if (!b) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const n = $(`.day[data-date="${addDays(b.dataset.date, step)}"]`);
    if (n) n.focus();
  };
}

// ---------- Day popover ----------
let lastAnchor = null;

export function closeMenu(refocus = true) {
  const pop = $('#popover');
  if (pop.hidden) return;
  pop.hidden = true;
  document.removeEventListener('pointerdown', outside, true);
  if (refocus && lastAnchor && document.contains(lastAnchor)) lastAnchor.focus({ preventScroll: true });
}
function outside(e) { if (!e.target.closest('#popover')) closeMenu(); }

export function openDayMenu(app, iso, anchor) {
  const ctx = app.ctx();
  const st = dayStatus(ctx, iso);
  const p = flsaPeriod(ctx, iso);
  const pop = $('#popover');
  lastAnchor = anchor;
  const item = (act, text, checked, extra = '') =>
    `<button role="menuitem" data-act="${act}" ${checked !== undefined ? `aria-checked="${checked}"` : ''}>${text}${extra}</button>`;
  let body = '';
  if (st.mine) {
    body += item('WORK', 'Working', st.kind === 'WORK');
    for (const [k, v] of Object.entries(LEAVE_TYPES)) body += item(k, v.label, st.kind === k);
  } else {
    const cur = st.kind === 'PU' ? Number(st.entry.hours) || 24 : 0;
    let mgText = '';
    if (!cur) {
      const mg = marginal(ctx, iso, 24);
      mgText = `<span class="tierchip ${tierClass(mg.tier)}">${mg.tier} · ${money0(mg.pay)}</span>`;
    }
    body += item('PU24', cur ? 'Planned pickup' : 'Pick up 24 h', cur ? true : undefined, cur ? '' : mgText);
    body += `<div class="custom"><label for="pu-h">Custom hours</label><input id="pu-h" type="number" min="1" max="24" step="0.5" value="${cur || 12}"><button class="btn btn-small" data-act="PUC">Set</button></div>`;
    if (cur) body += item('CLEAR', 'Remove pickup');
  }
  pop.innerHTML = `<header><strong>${fmtLong(iso)}</strong>
      <small>${st.shift} shift ${st.mine ? '· your shift' : '· off'}${st.holiday ? ` · ${esc(st.holiday)}` : ''}</small><br>
      <small>FLSA period ${fmtShort(p.start)}–${fmtShort(p.end)}: ${p.counted} h counted</small></header>${body}`;
  pop.hidden = false;
  placeNear(pop, anchor.getBoundingClientRect());
  pop.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));

  pop.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const prev = app.state.days[iso] ? { ...app.state.days[iso] } : null;
    let next = prev;
    if (act === 'WORK' || act === 'CLEAR') next = null;
    else if (LEAVE_TYPES[act]) next = { type: act, hours: 24 };
    else if (act === 'PU24') next = st.kind === 'PU' ? prev : { type: 'PU', hours: 24 };
    else if (act === 'PUC') {
      const h = Math.min(24, Math.max(0.5, Number($('#pu-h').value) || 0));
      next = { type: 'PU', hours: h };
    }
    closeMenu();
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    app.commit((s) => { if (next) s.days[iso] = next; else delete s.days[iso]; }, {
      message: next ? `${fmtShort(iso)}: ${next.type === 'PU' ? `pickup ${next.hours} h` : LEAVE_TYPES[next.type].label}` : `${fmtShort(iso)} cleared`,
      undo: (s) => { if (prev) s.days[iso] = prev; else delete s.days[iso]; },
    });
  };
  pop.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = $$('[role="menuitem"]', pop);
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
    if (e.key === 'Enter' && e.target.id === 'pu-h') { e.preventDefault(); pop.querySelector('[data-act="PUC"]').click(); }
  };
}

