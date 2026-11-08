import { DEFAULT_STATE } from './payroll.js';

const KEY = 'flsa-planner-v1';

function merge(def, saved) {
  if (Array.isArray(def)) return Array.isArray(saved) ? saved : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(saved)) out[k] = k in def ? merge(def[k], saved[k]) : saved[k];
    }
    return out;
  }
  return saved === undefined ? def : saved;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE();
    return merge(DEFAULT_STATE(), JSON.parse(raw));
  } catch {
    return DEFAULT_STATE();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or disabled */ }
}

export function exportJSON(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flsa-plan-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importJSON(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.profile) throw new Error('Not a planner file');
  return merge(DEFAULT_STATE(), data);
}

export function reset() { localStorage.removeItem(KEY); return DEFAULT_STATE(); }
