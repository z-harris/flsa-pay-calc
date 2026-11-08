import { load, save } from './storage.js';
import { makeCtx } from './payroll.js';
import { todayISO } from './schedule.js';
import { $, $$ } from './ui/util.js';
import { renderLegend, renderPeriods, renderCalendar, closeMenu } from './ui/calendar.js';
import { renderBestDays, bindBestDays } from './ui/bestDays.js';
import { computeChecks, renderKpis, renderChart, renderTable } from './ui/paychecks.js';
import { renderSettings } from './ui/settings.js';
import { openOnboarding } from './ui/onboarding.js';
import { exportPdf } from './pdf.js';

let state = load();
let ctxCache = null;
let checksCache = null;
let toastTimer = null;

const app = {
  get state() { return state; },
  ctx() { return (ctxCache ??= makeCtx(state)); },
  range() {
    const start = state.view.start || todayISO().slice(0, 7);
    const months = Number(state.view.months) || 12;
    const [y, m] = start.split('-').map(Number);
    const endY = y + Math.floor((m - 1 + months) / 12), endM = ((m - 1 + months) % 12) + 1;
    const last = new Date(Date.UTC(endY, endM - 1, 0)).toISOString().slice(0, 10);
    return { from: `${start}-01`, to: last, months };
  },
  /** Mutate state, save, re-render. opts: { message, undo, quiet } */
  commit(mutator, opts = {}) {
    mutator(state);
    save(state);
    render();
    const msg = typeof opts.message === 'function' ? opts.message() : opts.message;
    if (msg && !opts.quiet) toast(msg, opts.undo);
  },
  replace(ns, msg) { state = ns; save(state); render(); if (msg) toast(msg); },
  toast: (m) => toast(m),
  onboard: () => openOnboarding(app),
};

function toast(message, undo) {
  const el = $('#snackbar');
  el.innerHTML = `<span>${message}</span>${undo ? '<button>Undo</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 6000 : 3000);
  if (undo) el.querySelector('button').onclick = () => {
    el.hidden = true;
    undo(state); save(state); render();
  };
}

function applyTheme() {
  const t = state.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.theme;
  document.documentElement.dataset.theme = t;
}

function render() {
  ctxCache = null;
  closeMenu(false);
  applyTheme();
  document.body.dataset.shift = state.profile.shift;
  $$('#shift-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.shift === state.profile.shift)));
  $('#view-start').value = state.view.start || todayISO().slice(0, 7);
  $('#view-months').value = String(state.view.months);
  renderLegend(app);
  renderPeriods(app);
  renderCalendar(app);
  renderBestDays(app);
  checksCache = computeChecks(app);
  renderKpis(app, checksCache);
  renderChart(app, checksCache);
  renderTable(app, checksCache);
}

function doPdf() {
  const ok = exportPdf(state, checksCache || computeChecks(app), app.range());
  if (!ok) { toast('PDF library unavailable offline — opening print instead'); setTimeout(() => window.print(), 300); }
}

function bind() {
  $('#shift-seg').onclick = (e) => {
    const b = e.target.closest('[data-shift]');
    if (!b || b.dataset.shift === state.profile.shift) return;
    const prev = state.profile.shift;
    app.commit((s) => { s.profile.shift = b.dataset.shift; }, {
      message: `Showing ${b.dataset.shift} shift`, undo: (s) => { s.profile.shift = prev; },
    });
  };
  $('#shift-seg').onkeydown = (e) => {
    const order = ['A', 'B', 'C'];
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = order[(order.indexOf(state.profile.shift) + d + 3) % 3];
    app.commit((s) => { s.profile.shift = next; });
    $(`#shift-seg [data-shift="${next}"]`).focus();
  };
  $('#view-start').onchange = (e) => e.target.value && app.commit((s) => { s.view.start = e.target.value; });
  $('#view-months').onchange = (e) => app.commit((s) => { s.view.months = Number(e.target.value); });
  $('#theme-btn').onclick = () => {
    const cur = document.documentElement.dataset.theme;
    app.commit((s) => { s.theme = cur === 'dark' ? 'light' : 'dark'; });
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.theme === 'auto' && applyTheme());
  const openSettings = () => { renderSettings(app); $('#settings').showModal(); };
  $('#settings-btn').onclick = openSettings;
  $('#settings').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#pdf-btn').onclick = doPdf;
  $('#pdf-btn-2').onclick = doPdf;
  $('#print-btn').onclick = () => window.print();
  $$('.tabbar button').forEach((b) => (b.onclick = () => {
    if (b.dataset.open === 'settings') return openSettings();
    document.body.dataset.tab = b.dataset.tab;
    scrollTo({ top: 0 });
  }));
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => checksCache && renderChart(app, checksCache), 150); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  addEventListener('scroll', () => closeMenu(false), { passive: true });
  bindBestDays(app);
}

bind();
render();
if (!state.onboarded) openOnboarding(app);
