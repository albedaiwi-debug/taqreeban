// Audits data/questions.json:
//  - every answer equals its formula (recalculated here)
//  - every question has text, unit, at least one fact, and a source link (unless it's a pure calculation)
//  - ids are unique
// Run: node test/verify-questions.js        (check only)
//      node test/verify-questions.js --fix  (write answers from formulas)
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'questions.json');
const qs = JSON.parse(fs.readFileSync(file, 'utf8'));
const fix = process.argv.includes('--fix');

const evalFormula = (f) => {
  if (!/^[\d\s.e+\-*/()]+$/.test(f)) throw new Error(`unsafe formula: ${f}`);
  return Function(`"use strict"; return (${f});`)();
};
const tidy = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

const problems = [];
const ids = new Set();
for (const q of qs) {
  const where = `[${q.id}]`;
  if (ids.has(q.id)) problems.push(`${where} duplicate id`);
  ids.add(q.id);
  for (const k of ['text', 'unit', 'formula', 'napkin', 'category', 'scope']) if (!q[k]) problems.push(`${where} missing ${k}`);
  if (!Array.isArray(q.facts) || !q.facts.length) problems.push(`${where} no facts`);
  const pureCalc = (q.facts || []).every((f) => f.source?.name === 'حساب مباشر');
  if (!pureCalc && !(q.facts || []).some((f) => /^https?:\/\//.test(f.source?.url || ''))) problems.push(`${where} no source link`);
  let v;
  try { v = tidy(evalFormula(q.formula)); } catch (e) { problems.push(`${where} ${e.message}`); continue; }
  if (fix) q.answer = v;
  else if (!(q.answer > 0) || Math.abs(q.answer - v) / v > 0.005) problems.push(`${where} answer ${q.answer} ≠ formula ${v}`);
}

if (fix) {
  fs.writeFileSync(file, JSON.stringify(qs, null, 2) + '\n');
  console.log(`Wrote answers for ${qs.length} questions`);
}
const byType = qs.reduce((a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a), {});
const byScope = qs.reduce((a, q) => ((a[q.scope] = (a[q.scope] || 0) + 1), a), {});
console.log(`${qs.length} questions · types ${JSON.stringify(byType)} · scope ${JSON.stringify(byScope)}`);
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('ALL QUESTIONS VERIFIED');
