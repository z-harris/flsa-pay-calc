import { bestDays, planTopN } from '../payroll.js';
import { fmtShort, fmtDow, todayISO, MONTH_NAMES } from '../schedule.js';
import { esc, money, tierClass, $ } from './util.js';

let shown = 25;

function window_(app) {
  const { from, to } = app.range();
  const today = todayISO();
  return { from: from > today ? from : today, to };
}

export function renderBestDays(app, { resetPaging = false } = {}) {
  if (resetPaging) shown = 25;
  const ctx = app.ctx();
  const { from, to } = window_(app);
  const opts = { excludeAdjacent: $('#f-adjacent').checked, only2x: $('#f-2x').checked, month: $('#f-month').value };

  // Month filter options
  const sel = $('#f-month');
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
    months.push(m);
    const [y, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  const cur = sel.value;
  sel.innerHTML = `<option value="">All months</option>` + months.map((m) => {
    const [y, mm] = m.split('-').map(Number);
    return `<option value="${m}">${MONTH_NAMES[mm - 1].slice(0, 3)} ${y}</option>`;
  }).join('');
  sel.value = months.includes(cur) ? cur : '';
  opts.month = sel.value;

  const list = bestDays(ctx, from, to, opts);
  const el = $('#best-list');
  if (!list.length) {
    el.innerHTML = `<li class="empty">No open days match these filters.<br>Try turning off “2x only” or “Hide back-to-back days”.</li>`;
    $('#best-more').hidden = true;
    return;
  }
  el.innerHTML = list.slice(0, shown).map((d, i) => `
    <li class="bcard">
      <span class="rank">${i + 1}</span>
      <div>
        <div class="bd">${fmtDow(d.date)}, ${fmtShort(d.date)}</div>
        <div class="bm">
          <span class="tierchip ${tierClass(d.tier)}">${d.tier}</span>
          <span>${d.period.counted} h in period</span>
          ${d.holiday ? `<span title="Holiday">★ ${esc(d.holiday)}</span>` : ''}
          ${d.adjacent ? `<span class="flag" title="${d.adjOwn ? 'Next to your own shift' : 'Next to another pickup'} — would be 48 h straight">⚠ back-to-back</span>` : ''}
        </div>
      </div>
      <div class="bv">
        <span class="money">${money(d.pay)}</span>
        <button class="btn btn-small add" data-add="${d.date}" aria-label="Add pickup on ${fmtShort(d.date)}">+ Add</button>
      </div>
    </li>`).join('');
  $('#best-more').hidden = list.length <= shown;
}

export function bindBestDays(app) {
  ['#f-adjacent', '#f-2x', '#f-month'].forEach((s) => $(s).addEventListener('change', () => renderBestDays(app, { resetPaging: true })));
  $('#best-more').onclick = () => { shown += 25; renderBestDays(app); };
  $('#best-list').onclick = (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const iso = b.dataset.add;
    app.commit((s) => { s.days[iso] = { type: 'PU', hours: 24 }; }, {
      message: `Pickup added: ${fmtShort(iso)}`,
      undo: (s) => { delete s.days[iso]; },
    });
  };
  $('#plan-btn').onclick = () => {
    const n = Math.min(60, Math.max(1, Number($('#plan-n').value) || 1));
    const { from, to } = window_(app);
    let added = [];
    app.commit((s) => { added = planTopN(s, from, to, n, { only2x: $('#f-2x').checked, month: $('#f-month').value }); }, {
      message: () => (added.length ? `Added ${added.length} pickup${added.length > 1 ? 's' : ''}` : 'No open days left to add'),
      undo: (s) => { for (const d of added) delete s.days[d]; },
    });
  };
}
