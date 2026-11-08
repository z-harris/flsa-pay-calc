import { lookup, parseGradeStep } from '../payPlan.js';
import { shiftOn, todayISO, addDays, fmtShort } from '../schedule.js';
import { money, $ } from './util.js';

let step = 0;
let draft = null;

export function openOnboarding(app) {
  step = 0;
  draft = {
    shift: app.state.profile.shift,
    gs: `${app.state.profile.grade.slice(1)}-${app.state.profile.step}`,
    urs: 7.08, health: 0, fed: 10,
  };
  const dlg = $('#onboarding');
  render(app);
  if (!dlg.open) dlg.showModal();
}

function nextShiftDays(shift) {
  const out = [];
  for (let i = 0, d = todayISO(); out.length < 3 && i < 20; i++, d = addDays(d, 1)) if (shiftOn(d) === shift) out.push(fmtShort(d));
  return out.join(', ');
}

function render(app) {
  const dlg = $('#onboarding');
  const g = parseGradeStep(draft.gs);
  const l = g && lookup(g.grade, g.step);
  const pages = [
    `<h2 id="ob-h">Which shift are you on?</h2>
     <p class="hint">Your rotation: 24 on / 24 off / 24 on / 24 off / 24 on, then 4 days off.</p>
     <div class="ob-shifts" role="radiogroup" aria-label="Shift">
       ${['A', 'B', 'C'].map((s) => `<button class="ob-shift" role="radio" aria-checked="${draft.shift === s}" data-s="${s}" style="color:var(--${s.toLowerCase()})">${s}<small>next: ${nextShiftDays(s)}</small></button>`).join('')}
     </div>`,
    `<h2 id="ob-h">What's your grade and step?</h2>
     <p class="hint">As it appears on your paystub, e.g. <strong>18-1</strong> for Firefighter step 1 or <strong>23-4</strong> for Lieutenant step 4.</p>
     <label class="field"><span>Grade-step</span><input type="text" id="ob-gs" value="${draft.gs}" inputmode="numeric" autocomplete="off"></label>
     <div class="preview" id="ob-prev" style="margin-top:10px">${l ? `<strong>F${g.grade.slice(1)} ${l.title}, step ${l.step}</strong><br>Hourly (24-hr shift) <strong>${money(l.h3)}</strong> · biweekly <strong>${money(l.biweekly)}</strong> · annual <strong>${money(l.annual)}</strong>` : 'Enter a grade-step like 18-1 (grades 17–33, steps 1–26).'}</div>
     <p class="hint">From the FY2027 Pay Plan F. You can also set a manual rate later in Settings.</p>`,
    `<h2 id="ob-h">Quick deductions <span class="hint">(optional)</span></h2>
     <p class="hint">Rough numbers are fine — you can fine-tune and calibrate against a real paystub in Settings.</p>
     <div class="fgrid">
       <label class="field"><span>Pension (URS) % of base</span><input type="number" step="0.01" id="ob-urs" value="${draft.urs}"><small>7.08% for Plans B, D, E, F</small></label>
       <label class="field"><span>Health/dental per check ($)</span><input type="number" step="0.01" id="ob-health" value="${draft.health}"></label>
       <label class="field"><span>Federal income tax (est. %)</span><input type="number" step="0.5" id="ob-fed" value="${draft.fed}"></label>
     </div>`,
  ];
  dlg.innerHTML = `
    <div class="dlg-head"><div class="steps" aria-hidden="true">${pages.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
      <button class="btn btn-ghost btn-small" id="ob-skip">Skip setup</button></div>
    <div class="dlg-body">${pages[step]}</div>
    <div class="dlg-foot">
      <button class="btn btn-ghost" id="ob-back" ${step === 0 ? 'disabled' : ''}>Back</button>
      <button class="btn btn-primary" id="ob-next">${step === pages.length - 1 ? 'Finish' : 'Next'}</button>
    </div>`;

  dlg.querySelectorAll('.ob-shift').forEach((b) => (b.onclick = () => { draft.shift = b.dataset.s; render(app); }));
  const gs = $('#ob-gs');
  if (gs) {
    gs.focus();
    gs.oninput = () => {
      draft.gs = gs.value;
      const g2 = parseGradeStep(gs.value), l2 = g2 && lookup(g2.grade, g2.step);
      $('#ob-prev').innerHTML = l2 ? `<strong>${g2.grade} ${l2.title}, step ${l2.step}</strong><br>Hourly (24-hr shift) <strong>${money(l2.h3)}</strong> · biweekly <strong>${money(l2.biweekly)}</strong> · annual <strong>${money(l2.annual)}</strong>` : 'Enter a grade-step like 18-1 (grades 17–33, steps 1–26).';
    };
    gs.onkeydown = (e) => { if (e.key === 'Enter') $('#ob-next').click(); };
  }
  $('#ob-skip').onclick = () => finish(app, false);
  $('#ob-back').onclick = () => { capture(); step--; render(app); };
  $('#ob-next').onclick = () => {
    capture();
    if (step === 1 && !parseGradeStep(draft.gs)) { $('#ob-gs').setCustomValidity('Use grade-step like 18-1'); $('#ob-gs').reportValidity(); return; }
    if (step === 2) finish(app, true); else { step++; render(app); }
  };
}

function capture() {
  if ($('#ob-urs')) {
    draft.urs = Number($('#ob-urs').value) || 0;
    draft.health = Number($('#ob-health').value) || 0;
    draft.fed = Number($('#ob-fed').value) || 0;
  }
}

function finish(app, apply) {
  $('#onboarding').close();
  app.commit((s) => {
    s.onboarded = true;
    if (!apply) return;
    s.profile.shift = draft.shift;
    const g = parseGradeStep(draft.gs);
    if (g) { s.profile.grade = g.grade; s.profile.step = g.step; s.profile.rateOverride = null; }
    const set = (id, v, on = true) => { const d = s.deductions.find((x) => x.id === id); if (d) { d.value = v; d.on = on && v > 0; } };
    set('urs', draft.urs);
    set('health', draft.health);
    set('fed', draft.fed);
  }, { message: apply ? 'All set — tap any day to plan leave or pickups' : undefined, quiet: !apply });
}
