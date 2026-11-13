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
  const other = (c) => c.als + c.riding - c.lwopDed;
  const otH = (c) => c.h1 + c.h15 + c.h2;
  doc.autoTable({
    startY: 74,
    head: [['Pay date', 'Pay period', 'Base', 'Shift diff', 'FLSA prem.', 'Hireback', 'Holiday', 'Other', 'Gross', 'Deductions', 'Net']],
    body: checks.map((c) => [
      fmtMDY(c.payDate), `${fmtShort(c.start)} – ${fmtShort(c.end)}`, m(c.base), m(c.shiftDiff), m(c.schedPrem),
      `${otH(c) ? `${otH(c)} h · ` : ''}${m(c.otPay)}`, m(c.holidayPay), m(other(c)), m(c.gross), `-${m(c.dedTotal - c.adjust)}`, m(c.net),
    ]),
    foot: [['Total', `${checks.length} checks`, m(sum('base')), m(sum('shiftDiff')), m(sum('schedPrem')), m(sum('otPay')),
      m(sum('holidayPay')), m(checks.reduce((a, c) => a + other(c), 0)), m(sum('gross')), `-${m(sum('dedTotal') - sum('adjust'))}`, m(sum('net'))]],
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, halign: 'right', textColor: [15, 23, 42] },
    columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 10: { fontStyle: 'bold' } },
    headStyles: { fillColor: [241, 243, 246], textColor: [71, 85, 105], fontStyle: 'bold', halign: 'right' },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold', halign: 'right' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    didParseCell: (d) => { if (d.section !== 'body' && d.column.index < 2) d.cell.styles.halign = 'left'; },
    margin: { left: 40, right: 40 },
  });

  // Deductions summary
  const dedNames = new Map();
  for (const c of checks) for (const d of c.deds) dedNames.set(d.name, (dedNames.get(d.name) || 0) + d.amount);
  let yPos = doc.lastAutoTable.finalY + 18;
  if (dedNames.size) {
    doc.autoTable({
      startY: yPos,
      head: [['Deduction (range total)', 'Amount']],
      body: [...dedNames].map(([n, v]) => [n, m(v)]),
      styles: { fontSize: 8.5, cellPadding: 3 },
      columnStyles: { 1: { halign: 'right' } },
      headStyles: { fillColor: [241, 243, 246], textColor: [71, 85, 105] },
      tableWidth: 300, margin: { left: 40 },
    });
    yPos = doc.lastAutoTable.finalY + 18;
  }

  const r = state.rules;
  const notes = [
    `Rates: ${PLAN_LABEL}; 24-hr hourly = annual / 2,912. OT: ${r.m1}x over ${r.t1} h and ${r.m2}x over ${r.t2} h per 28-day FLSA period.${r.halfAdjust ? ` First-half checks adjusted to ${r.halfTarget} h; the difference slides to the second-half check.` : ''}`,
    `Shift differential $${r.shiftDiff}/h on regular hours. Holidays: ${r.holidayWorked} h worked / ${r.holidayOff} h not worked. Pay date = period end + ${state.anchors.paydayOffset} days.`,
    'ESTIMATES ONLY — not official payroll. Sources: Fairfax County FY2027 Pay Plan F; Personnel Regulations Ch. 2 & 4; IAFF Local 2068 CBA (2024–2027).',
  ];
  doc.setFontSize(8).setTextColor(100, 116, 139);
  if (yPos > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); yPos = 40; }
  notes.forEach((t, i) => doc.text(doc.splitTextToSize(t, W - 80), 40, yPos + i * 12));

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
  doc.save(`paychecks-${range.from.slice(0, 7)}-${range.months}mo.pdf`);
  return true;
}
