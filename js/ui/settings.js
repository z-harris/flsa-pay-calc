import { GRADES, MAX_STEP, parseGradeStep, PLAN_LABEL } from '../payPlan.js';
import { rateOn, paychecks, makeCtx } from '../payroll.js';
import { holidaysForYear, fmtMDY, todayISO, addDays } from '../schedule.js';
import { exportJSON, importJSON, reset } from '../storage.js';
import { esc, money, $, $$, getPath, setPath } from './util.js';

const OK = '<span class="ok-badge" title="Verified against county documents">verified</span>';
const WARN = '<span class="warn-badge" title="Not in public documents — confirm with your paystub">verify</span>';
const openSecs = new Set(['pay']);

function f(label, inner, { hint = '', full = false, badge = '' } = {}) {
  return `<label class="field ${full ? 'full' : ''}"><span>${label}${badge}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
}
const num = (path, v, attrs = '') => `<input type="number" data-bind="${path}" data-type="num" value="${v ?? ''}" ${attrs}>`;
const chk = (path, v, text) => `<label class="check"><input type="checkbox" data-bind="${path}" data-type="bool" ${v ? 'checked' : ''}> ${text}</label>`;

function sec(id, title, body) {
  return `<details class="acc" data-sec="${id}" ${openSecs.has(id) ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
}

function payPreview(state) {
  const r = rateOn(state, todayISO());
  const ru = state.rules;
  const ot = r.h3 + (ru.regRateIncludesDiff && ru.shiftDiffOn ? ru.shiftDiff : 0);
  return `24-hr hourly rate <strong>${money(r.h3)}</strong> · biweekly <strong>${money(r.biweekly)}</strong> · annual <strong>${money(r.annual)}</strong><br>
    Overtime ${ru.m1}x = <strong>${money(ot * ru.m1)}</strong>/h · ${ru.m2}x = <strong>${money(ot * ru.m2)}</strong>/h · 24 h at ${ru.m2}x = <strong>${money(ot * ru.m2 * 24)}</strong>`;
}

export function renderSettings(app) {
  const s = app.state, p = s.profile, r = s.rules, a = s.anchors;
  const y = new Date().getFullYear();
  const hols = [y, y + 1].flatMap(holidaysForYear);
  const flsaA = a.payPeriod, flsaB = addDays(a.payPeriod, 14);
  const ctx = makeCtx(s);
  const checks = paychecks(ctx, addDays(todayISO(), -120), addDays(todayISO(), 30));
  const lastPast = checks.reduce((k, c, i) => (c.payDate <= todayISO() ? i : k), checks.length - 1);

  const body = [
    sec('pay', 'Your pay', `<div class="fgrid">
      ${f('Name (optional, for PDF)', `<input type="text" data-bind="profile.name" value="${esc(p.name)}" placeholder="e.g. FF J. Smith">`, { full: true })}
      ${f('Quick entry', `<input type="text" id="gs-quick" placeholder="18-1" value="${p.grade.slice(1)}-${p.step}">`, { hint: 'Grade-step, e.g. 18-1 or 23-4' })}
      ${f('Grade', `<select data-bind="profile.grade" data-type="str">${Object.entries(GRADES).map(([g, v]) => `<option value="${g}" ${g === p.grade ? 'selected' : ''}>${g} · ${v.title}</option>`).join('')}</select>`)}
      ${f('Step', `<select data-bind="profile.step" data-type="num">${Array.from({ length: MAX_STEP }, (_, i) => `<option ${i + 1 === p.step ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>`)}
      ${f('Manual hourly rate (optional)', `<input type="number" step="0.0001" data-bind="profile.rateOverride" data-type="numOrNull" value="${p.rateOverride ?? ''}" placeholder="overrides grade/step">`, { hint: '24-hour shift rate (annual ÷ 2,912)' })}
      ${f('Next step increase on', `<input type="date" data-bind="profile.nextStepDate" value="${p.nextStepDate || ''}">`, { hint: 'Moves you up one step from this date' })}
      ${f('Assumed raise from FY2028 (%)', num('profile.raisePct', p.raisePct, 'step="0.1"'), { hint: 'CBA runs through June 30, 2027' })}
      <div class="preview full" id="pay-preview">${payPreview(s)}</div>
      <small class="full hint">Rates: ${PLAN_LABEL}. ${OK}</small>
    </div>`),
    sec('prem', 'Premiums', `<div class="fgrid">
      <div class="full">${chk('rules.shiftDiffOn', r.shiftDiffOn, 'Shift differential on regular hours worked')} ${OK}</div>
      ${f('Shift differential ($/h)', num('rules.shiftDiff', r.shiftDiff, 'step="0.0001"'), { hint: 'CBA §75.5A: $0.7275, not paid on overtime' })}
      <div></div>
      <div class="full">${chk('profile.paramedic', p.paramedic, 'ALS paramedic certification pay')} ${OK}</div>
      ${f('Paramedic premium (% of base)', num('profile.alsPct', p.alsPct, 'step="0.5"'), { hint: 'CBA §75.2: 10%' })}
      ${f('ALS lead riding pay', `<select data-bind="profile.ridingRate" data-type="num">
          <option value="0" ${!p.ridingRate ? 'selected' : ''}>None</option>
          <option value="2" ${p.ridingRate == 2 ? 'selected' : ''}>$2/h — non-transport lead</option>
          <option value="3" ${p.ridingRate == 3 ? 'selected' : ''}>$3/h — transport lead</option></select>`, { hint: 'CBA §75.3' })}
    </div>`),
    sec('ot', 'Overtime rules', `<div class="fgrid">
      ${f('FLSA threshold (h / 28 days)', num('rules.t1', r.t1), { badge: OK, hint: 'Personnel Regs §4.12' })}
      ${f('Rate above it', num('rules.m1', r.m1, 'step="0.1"'), { badge: OK })}
      ${f('Double-time threshold (h)', num('rules.t2', r.t2), { badge: WARN, hint: 'Reported: >240 h per 2 pay periods' })}
      ${f('Rate above it', num('rules.m2', r.m2, 'step="0.1"'), { badge: WARN })}
      <div class="full">${chk('rules.leaveCounts', r.leaveCounts, 'Paid leave counts toward the thresholds')} ${OK}</div>
      <div class="full">${chk('rules.regRateIncludesDiff', r.regRateIncludesDiff, 'OT “regular rate” includes shift differential')} ${OK}</div>
      <div class="full">${chk('rules.scheduledPremium', r.scheduledPremium, 'Pay FLSA premium on scheduled hours over the threshold')} ${WARN}</div>
      ${f('When overtime is paid', `<select data-bind="rules.otTiming" data-type="str">
          <option value="periodEnd" ${r.otTiming === 'periodEnd' ? 'selected' : ''}>After the 28-day period closes</option>
          <option value="byDate" ${r.otTiming === 'byDate' ? 'selected' : ''}>In the pay period worked</option></select>`, { badge: WARN, full: true })}
    </div>`),
    sec('hol', 'Holidays', `<div class="fgrid">
      ${f('Holiday worked (h)', num('rules.holidayWorked', r.holidayWorked, 'step="0.1"'), { badge: WARN })}
      ${f('Holiday not worked (h)', num('rules.holidayOff', r.holidayOff, 'step="0.1"'), { badge: OK, hint: '0.1 × 112 biweekly hours' })}
      <div class="full">
        <div class="hol-list">${hols.map((h) => {
          const removed = s.holidaysRemoved.includes(h.date);
          return `<div><span style="${removed ? 'text-decoration:line-through;opacity:.6' : ''}">${fmtMDY(h.date)} · ${esc(h.name)}</span>
            <button class="btn btn-ghost btn-small" data-hol-toggle="${h.date}">${removed ? 'Restore' : 'Remove'}</button></div>`;
        }).join('')}
        ${s.holidaysCustom.map((h, i) => `<div><span>${fmtMDY(h.date)} · ${esc(h.name)} (custom)</span><button class="x-btn" data-hol-del="${i}" aria-label="Delete">×</button></div>`).join('')}
        </div>
        <div class="row" style="justify-content:flex-start"><input type="date" id="hol-date"><input type="text" id="hol-name" placeholder="Name" style="flex:1"><button class="btn btn-small" id="hol-add">Add</button></div>
        <small class="hint">CBA Art. 51 list ${OK}</small>
      </div>
    </div>`),
    sec('anchors', 'Pay period & FLSA cycle', `<div class="fgrid">
      ${f('A pay period starts on', `<input type="date" data-bind="anchors.payPeriod" value="${a.payPeriod}">`, { badge: OK, hint: 'Any Saturday that starts a pay period (FY2027 began 7/11/2026)' })}
      ${f('Payday (days after period ends)', num('anchors.paydayOffset', a.paydayOffset), { badge: WARN })}
      ${f('28-day FLSA cycle starts with the pay period beginning', `<select data-bind="anchors.flsaOffset" data-type="num">
          <option value="0" ${!a.flsaOffset ? 'selected' : ''}>${fmtMDY(flsaA)} (and every 28 days)</option>
          <option value="14" ${a.flsaOffset ? 'selected' : ''}>${fmtMDY(flsaB)} (and every 28 days)</option></select>`, { badge: WARN, full: true, hint: 'Check your stub: FLSA overtime usually appears on every other check.' })}
    </div>`),
    sec('ded', 'Deductions & calibration', `
      <p class="hint" style="margin-top:0">Per-paycheck. Percent of base = salary only (e.g. pension); percent of gross = includes overtime (e.g. taxes).</p>
      <div id="ded-rows">${s.deductions.map((d, i) => `<div class="ded-row">
        <input type="checkbox" data-ded="${i}" data-field="on" ${d.on ? 'checked' : ''} aria-label="Enabled">
        <input type="text" data-ded="${i}" data-field="name" value="${esc(d.name)}" aria-label="Name">
        <select data-ded="${i}" data-field="type" aria-label="Type">
          <option value="pctGross" ${d.type === 'pctGross' ? 'selected' : ''}>% of gross</option>
          <option value="pctBase" ${d.type === 'pctBase' ? 'selected' : ''}>% of base</option>
          <option value="fixed" ${d.type === 'fixed' ? 'selected' : ''}>$ fixed</option></select>
        <input type="number" step="0.01" data-ded="${i}" data-field="value" value="${d.value}" aria-label="Amount">
        <button class="x-btn" data-ded-del="${i}" aria-label="Remove">×</button></div>`).join('')}</div>
      <button class="btn btn-small" id="ded-add">+ Add deduction</button>
      <p class="hint">URS employee rate: 7.08% (Plans B, D, E, F); 4.00% (Plans A, C). ${OK}</p>
      <div class="calib">
        <strong>Calibrate to a real paystub</strong>
        <p class="hint" style="margin-top:2px">Pick a recent check and enter its actual net pay. The difference is applied to every estimate.</p>
        <div class="row" style="justify-content:flex-start">
          <select id="cal-date">${checks.map((c, i) => `<option value="${c.start}" ${(s.calib.payDate ? c.payDate === s.calib.payDate : i === lastPast) ? 'selected' : ''}>Paid ${fmtMDY(c.payDate)} — est. ${money(c.netRaw)}</option>`).join('')}</select>
          <input type="number" id="cal-actual" step="0.01" placeholder="Actual net" style="width:130px" value="${s.calib.actual ?? ''}">
          <button class="btn btn-small" id="cal-apply">Apply</button>
        </div>
        <p class="hint">Current adjustment: <strong>${money(s.calib.adjust)}</strong> per check ${s.calib.adjust ? '<button class="btn btn-ghost btn-small" id="cal-clear">Clear</button>' : ''}</p>
      </div>`),
    sec('data', 'Your data', `<div class="fgrid">
      <p class="hint full" style="margin:0">Everything is stored only in this browser. Export a backup to move between devices.</p>
      <button class="btn" id="d-export">Export backup</button>
      <label class="btn" style="justify-content:center">Import backup<input type="file" id="d-import" accept="application/json" hidden></label>
      <button class="btn" id="d-onboard">Run setup again</button>
      <button class="btn" id="d-clear-days">Clear all leave & pickups</button>
      <button class="btn full" id="d-reset" style="color:var(--brand)">Reset everything</button>
    </div>`),
  ].join('');

  const dlg = $('#settings');
  dlg.innerHTML = `<div class="dlg-head"><h2 id="set-h">Settings</h2><button class="icon-btn" id="set-close" aria-label="Close settings">✕</button></div><div class="dlg-body">${body}</div>`;
  bind(app, dlg);
}

function rerender(app) {
  const dlg = $('#settings');
  const scroll = dlg.querySelector('.dlg-body')?.scrollTop || 0;
  renderSettings(app);
  dlg.querySelector('.dlg-body').scrollTop = scroll;
}

function bind(app, dlg) {
  $('#set-close', dlg).onclick = () => dlg.close();
  $$('details.acc', dlg).forEach((d) => d.addEventListener('toggle', () => (d.open ? openSecs.add(d.dataset.sec) : openSecs.delete(d.dataset.sec))));

  dlg.onchange = (e) => {
    const t = e.target;
    if (t.dataset.bind) {
      const type = t.dataset.type || (t.type === 'number' ? 'num' : 'str');
      let v = type === 'bool' ? t.checked : t.value;
      if (type === 'num') v = Number(v) || 0;
      if (type === 'numOrNull') v = t.value === '' ? null : Number(t.value);
      if (getPath(app.state, t.dataset.bind) === v) return;
      app.commit((s) => setPath(s, t.dataset.bind, v), { quiet: true });
      if (['profile.grade', 'profile.step', 'anchors.payPeriod'].includes(t.dataset.bind)) rerender(app);
      else $('#pay-preview').innerHTML = payPreview(app.state);
    } else if (t.dataset.ded !== undefined) {
      const i = +t.dataset.ded, fld = t.dataset.field;
      const v = fld === 'on' ? t.checked : fld === 'value' ? Number(t.value) || 0 : t.value;
      app.commit((s) => { s.deductions[i][fld] = v; }, { quiet: true });
    } else if (t.id === 'gs-quick') {
      const g = parseGradeStep(t.value);
      if (!g) { t.setCustomValidity('Use grade-step like 18-1'); t.reportValidity(); return; }
      t.setCustomValidity('');
      app.commit((s) => { s.profile.grade = g.grade; s.profile.step = g.step; s.profile.rateOverride = null; }, { quiet: true });
      rerender(app);
    } else if (t.id === 'd-import' && t.files[0]) {
      importJSON(t.files[0]).then((ns) => { app.replace(ns, 'Backup imported'); rerender(app); })
        .catch(() => app.toast('That file is not a planner backup'));
    }
  };

  dlg.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.holToggle) {
      const d = t.dataset.holToggle;
      app.commit((s) => {
        const i = s.holidaysRemoved.indexOf(d);
        if (i >= 0) s.holidaysRemoved.splice(i, 1); else s.holidaysRemoved.push(d);
      }, { quiet: true });
      rerender(app);
    } else if (t.dataset.holDel) {
      app.commit((s) => s.holidaysCustom.splice(+t.dataset.holDel, 1), { quiet: true }); rerender(app);
    } else if (t.id === 'hol-add') {
      const date = $('#hol-date').value, name = $('#hol-name').value.trim() || 'Holiday';
      if (!date) return;
      app.commit((s) => s.holidaysCustom.push({ date, name }), { quiet: true }); rerender(app);
    } else if (t.dataset.dedDel) {
      app.commit((s) => s.deductions.splice(+t.dataset.dedDel, 1), { quiet: true }); rerender(app);
    } else if (t.id === 'ded-add') {
      app.commit((s) => s.deductions.push({ id: `c${Date.now()}`, name: 'New deduction', type: 'fixed', value: 0, on: true }), { quiet: true });
      rerender(app);
    } else if (t.id === 'cal-apply') {
      const start = $('#cal-date').value, actual = Number($('#cal-actual').value);
      if (!start || !$('#cal-actual').value) return;
      const c = paychecks(makeCtx(app.state), start, start)[0];
      app.commit((s) => { s.calib = { adjust: Math.round((actual - c.netRaw) * 100) / 100, payDate: c.payDate, actual }; }, { message: 'Estimates calibrated to your paystub' });
      rerender(app);
    } else if (t.id === 'cal-clear') {
      app.commit((s) => { s.calib = { adjust: 0, payDate: '', actual: null }; }, { quiet: true }); rerender(app);
    } else if (t.id === 'd-export') exportJSON(app.state);
    else if (t.id === 'd-onboard') { dlg.close(); app.onboard(); }
    else if (t.id === 'd-clear-days') {
      const prev = app.state.days;
      app.commit((s) => { s.days = {}; }, { message: 'Cleared all leave & pickups', undo: (s) => { s.days = prev; } });
    } else if (t.id === 'd-reset') {
      if (confirm('Reset all settings, leave and pickups? This cannot be undone (export a backup first).')) {
        app.replace(reset(), 'Everything reset'); dlg.close(); app.onboard();
      }
    }
  };
}

