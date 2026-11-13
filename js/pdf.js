import { fmtMDY, fmtShort, MONTH_NAMES } from './schedule.js';
import { PLAN_LABEL } from './payPlan.js';

const m = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Export the paycheck table as a landscape PDF. Returns false if jsPDF isn't available. */
export function exportPdf(state, checks, range) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) return false;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  if (typeof doc.autoTable !== 'function') return false;
  const p = state.profile;
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(200, 16, 46);
  doc.rect(0, 0, W, 6, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(15, 23, 42);
  doc.text('Estimated Paychecks — FLSA Shift Planner', 40, 40);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(71, 85, 105);
  const [y, mo] = range.from.split('-').map(Number);
  const who = [
    p.name || null,
    `Shift ${p.shift}`,
    p.rateOverride ? `Manual rate $${p.rateOverride}/h` : `Grade ${p.grade} step ${p.step}`,
    `${MONTH_NAMES[mo - 1]} ${y} · ${range.months} months`,
    `Generated ${fmtMDY(new Date().toISOString().slice(0, 10))}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(who, 40, 58);

  const sum = (k) => checks.reduce((a, c) => a + c[k], 0);
  const sumH = (k) => checks.reduce((a, c) => a + c.hours[k], 0);
  const h = (n) => `${Math.round((Number(n) || 0) * 10) / 10}`;
  const sg = (n) => (Math.abs(n) < 0.05 ? '—' : `${n > 0 ? '+' : '-'}${h(Math.abs(n))}`);
  const per = (c) => `${fmtShort(c.start)} – ${fmtShort(c.end)}`;
  const r = state.rules;
  const table = (opts, leftCols = 2) => {
    doc.autoTable({
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, halign: 'right', textColor: [15, 23, 42] },
      headStyles: { fillColor: [241, 243, 246], textColor: [71, 85, 105], fontStyle: 'bold', halign: 'right' },
      footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold', halign: 'right' },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      didParseCell: (d) => { if (d.column.index < leftCols) d.cell.styles.halign = 'left'; },
      margin: { left: 40, right: 40 },
      ...opts,
    });
  };
  const heading = (text, y) => {
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 40; }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(15, 23, 42).text(text, 40, y);
    doc.setFont('helvetica', 'normal');
    return y + 8;
  };

  // Summary — same columns as the on-screen table
  table({
    startY: 74,
    head: [['Pay date', 'Pay period', 'Sched. h', 'Adj. h', 'Final h', 'Base', 'Gross', 'Deductions', 'Net']],
    body: checks.map((c) => [
      fmtMDY(c.payDate), per(c), h(c.hours.sched), sg(c.hours.adjust), h(c.hours.final),
      m(c.base), m(c.gross), `-${m(c.dedTotal - c.adjust)}`, m(c.net),
    ]),
    foot: [['Total', `${checks.length} checks`, h(sumH('sched')), sg(sumH('adjust')), h(sumH('final')),
      m(sum('base')), m(sum('gross')), `-${m(sum('dedTotal') - sum('adjust'))}`, m(sum('net'))]],
    columnStyles: { 4: { fontStyle: 'bold' }, 6: { fontStyle: 'bold' }, 8: { fontStyle: 'bold' } },
  });

  // Hours breakdown — scheduled → adjustments → final, and where the final hours fall
  const anyUncounted = checks.some((c) => c.hours.leaveUncounted);
  table({
    startY: heading('Hours breakdown', doc.lastAutoTable.finalY + 26),
    head: [['Pay date', 'Half', 'Sched.', 'Paid leave', 'LWOP', ...(anyUncounted ? ['Leave not counted'] : []), 'Hireback',
      'In period', ...(r.halfAdjust ? [`Half adj. (${r.halfTarget} h)`] : []), 'Final', 'Period hours', 'Straight', `${r.m1}x tier`, `${r.m2}x tier`]],
    body: checks.map((c) => {
      const x = c.hours;
      return [fmtMDY(c.payDate), c.isSecondHalf ? '2nd' : '1st', h(x.sched), h(x.leave), x.lwop ? `-${h(x.lwop)}` : '0',
        ...(anyUncounted ? [x.leaveUncounted ? `-${h(x.leaveUncounted)}` : '0'] : []), x.pickups ? `+${h(x.pickups)}` : '0',
        h(x.actual), ...(r.halfAdjust ? [sg(x.slide)] : []), h(x.final),
        `${h(x.periodFrom)}–${h(x.periodTo)} of ${h(x.periodTotal)}`, h(x.straight), h(x.t15), h(x.t2)];
    }),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3.5, halign: 'right', textColor: [15, 23, 42] },
  });

  // Earnings breakdown — every line item that makes up gross
  table({
    startY: heading('Earnings breakdown', doc.lastAutoTable.finalY + 26),
    head: [['Pay date', 'Base', 'Shift diff', 'FLSA prem.', 'Hireback', 'Holiday', 'ALS', 'Riding', 'LWOP', 'Gross', 'Deductions', 'Calib.', 'Net']],
    body: checks.map((c) => [
      fmtMDY(c.payDate), m(c.base), `${m(c.shiftDiff)} (${h(c.workedSched)} h)`, m(c.schedPrem),
      `${m(c.otPay)}${c.puHours ? ` (${[c.h2 && `${h(c.h2)}h@${r.m2}x`, c.h15 && `${h(c.h15)}h@${r.m1}x`, c.h1 && `${h(c.h1)}h@1x`].filter(Boolean).join(', ')})` : ''}`,
      `${m(c.holidayPay)}${c.holidays.length ? ` (${c.holidays.map((x) => x.name).join(', ')})` : ''}`,
      m(c.als), m(c.riding), c.lwopDed ? `-${m(c.lwopDed)}` : m(0), m(c.gross), `-${m(c.dedTotal)}`, c.adjust ? m(c.adjust) : '—', m(c.net),
    ]),
    foot: [['Total', m(sum('base')), m(sum('shiftDiff')), m(sum('schedPrem')), m(sum('otPay')), m(sum('holidayPay')), m(sum('als')),
      m(sum('riding')), `-${m(sum('lwopDed'))}`, m(sum('gross')), `-${m(sum('dedTotal'))}`, m(sum('adjust')), m(sum('net'))]],
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3, halign: 'right', textColor: [15, 23, 42] },
    columnStyles: { 4: { cellWidth: 95 }, 5: { cellWidth: 80 } },
  }, 1);

  // Deductions summary
  const dedNames = new Map();
  for (const c of checks) for (const d of c.deds) dedNames.set(d.name, (dedNames.get(d.name) || 0) + d.amount);
  let yPos = doc.lastAutoTable.finalY + 18;
  if (dedNames.size) {
    doc.autoTable({
      startY: yPos,
      head: [['Deduction (range total)', 'Amount']],
      pageBreak: 'avoid',
      body: [...dedNames].map(([n, v]) => [n, m(v)]),
      styles: { fontSize: 8.5, cellPadding: 3 },
      columnStyles: { 1: { halign: 'right' } },
      headStyles: { fillColor: [241, 243, 246], textColor: [71, 85, 105] },
      tableWidth: 300, margin: { left: 40 },
    });
    yPos = doc.lastAutoTable.finalY + 18;
  }

  const notes = [
    `Rates: ${PLAN_LABEL}; 24-hr hourly = annual / 2,912. OT: ${r.m1}x over ${r.t1} h and ${r.m2}x over ${r.t2} h per 28-day FLSA period.${r.halfAdjust ? ` First-half checks adjusted to ${r.halfTarget} h; the difference slides to the second-half check.` : ''}`,
    `Shift differential $${r.shiftDiff}/h on regular hours. Holidays: ${r.holidayWorked} h worked / ${r.holidayOff} h not worked. Pay date = period end + ${state.anchors.paydayOffset} days.`,
    'ESTIMATES ONLY — not official payroll. Sources: Fairfax County FY2027 Pay Plan F; Personnel Regulations Ch. 2 & 4; IAFF Local 2068 CBA (2024–2027).',
  ];
  doc.setFontSize(8).setTextColor(100, 116, 139);
  if (yPos > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); yPos = 40; }
  for (const t of notes) {
    const lines = doc.splitTextToSize(t, W - 80);
    doc.text(lines, 40, yPos);
    yPos += lines.length * 10 + 3;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
  doc.save(`paychecks-${range.from.slice(0, 7)}-${range.months}mo.pdf`);
  return true;
}
