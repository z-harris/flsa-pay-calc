# FLSA Shift Planner — Fairfax County Fire & Rescue

A static web app for 24-hour shift firefighters (A / B / C) to plan leave and hireback shifts, see which days pay **2x vs 1.5x**, and estimate biweekly paychecks (exportable to PDF).

No build step and no server — plain HTML, CSS and JavaScript modules. All data stays in the user's browser (localStorage).

## Features
- Enter grade-step (e.g. `18-1`) → rates from the FY2027 Pay Plan F, or a manual hourly rate
- 3 / 6 / 12-month calendar with your A/B/C rotation, holidays and 28-day FLSA periods
- Tap a day to mark annual / sick / comp leave, LWOP, or a hireback pickup
- **Best days to pick up** — ranked by the actual dollar value of a 24-h hireback given everything already planned; "Plan top N" adds the best ones automatically
- Biweekly paycheck table + chart: base, shift differential, FLSA premium, hireback OT, holiday pay, deductions, net
- Deductions (pension, taxes, insurance, dues…) and **calibration** against a real paystub
- PDF export, print, dark / light mode, mobile layout, JSON backup / restore

## Deploy to GitHub Pages
1. Create a repository and push these files to the `main` branch.
2. Repository → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000. (Opening `index.html` directly from disk won't work because browsers block ES modules on `file://`.)

Math tests: open `/tests.html`.

## How pay is modeled
| Rule | Value | Source |
|---|---|---|
| Hourly rate (24-hr shift) | annual ÷ 2,912 | Personnel Regs Ch. 2 |
| Rotation | 24 on/off ×3 then 4 off (9-day cycle, `A C A B A B C B C`) | — |
| Pay period / FLSA work period | 14 days / 28 days, starting Saturday | Regs Ch. 2 |
| OT 1.5x | hours worked + paid leave over 212 per 28 days | Regs §4.12 |
| OT 2x | over 240 h per 28 days | **user-reported — verify** |
| Shift differential | $0.7275/h on regular hours (not OT); included in the OT regular rate | CBA §75.5A; Regs Ch. 2 |
| Holidays | 11.2 h not worked (0.1 × 112) / 16 h worked (**verify**) | Regs §4.12-3; CBA Art. 51 list |
| Paramedic / riding pay | 10% of base / $2–3 per hour (optional) | CBA §75.2–75.3 |
| URS pension | 7.08% (Plans B, D, E, F) | URS |

Items marked **verify** (and which Saturday starts the 28-day cycle, payday offset, and OT payment timing) are editable in Settings.

**Estimates only — not official payroll.**

Sources: [FY2027 Pay Plan F](https://www.fairfaxcounty.gov/hr/sites/hr/files/Assets/documents/HR/CompensationPlans/FY2027/fplan.pdf) ·
[Personnel Regulations Ch. 4](https://www.fairfaxcounty.gov/hr/sites/hr/files/assets/documents/hr/chap4.pdf) ·
[Ch. 2](https://www.fairfaxcounty.gov/hr/sites/hr/files/assets/documents/hr/chap2.pdf) ·
[IAFF Local 2068 CBA 2024–2027](https://www.fairfaxcounty.gov/hr/sites/hr/files/Assets/documents/hr/collective%20bargaining/FRD_DPSC_CBA.pdf) ·
[URS contributions](https://www.fairfaxcounty.gov/retirement/employee-contributions-urs)
