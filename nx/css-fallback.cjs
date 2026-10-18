#!/usr/bin/env node
'use strict';
/* NX LEGACY: Chromium 108 (Electron 22) has no color-mix() (Chromium 111). A declaration it cannot parse is dropped,
   so the element would lose its colour. This script inserts, BEFORE every declaration that uses color-mix(), a fallback
   declaration with the dominant colour operand (cascade: the unsupported line is ignored on old Chromium, wins on new).
   Idempotent. usage: node nx/css-fallback.cjs [srcDir] [--check]                                            */
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src');
const check = process.argv.includes('--check');

function pickOperand(args) { // args = text after `color-mix(`: `in <space>, <colour> [p%], <colour> [p%]`
  let depth = 0, parts = [], cur = '';
  for (const ch of args) {
    if (ch === '(') { depth++; } else if (ch === ')') { if (depth === 0) { break; } depth--; }
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else { cur += ch; }
  }
  parts.push(cur.trim());
  if (parts.length < 3) { return null; }
  const split = (t) => { const m = /^(.*?)\s+(\d+(?:\.\d+)?)%\s*$/.exec(t); return m ? { c: m[1].trim(), p: parseFloat(m[2]) } : { c: t.trim(), p: null }; };
  const a = split(parts[1]), b = split(parts[2]);
  const strip = (x) => x.c.replace(/\s+var\([^)]*\)\s*$/, '').trim(); // `X var(--opacity, 92%)` -> X
  let pa = a.p, pb = b.p;
  if (pa === null && pb !== null) { pa = 100 - pb; } else if (pb === null && pa !== null) { pb = 100 - pa; } else if (pa === null) { pa = 50; pb = 50; }
  // The dominant colour wins (ties -> first). A faint tint over `transparent` therefore degrades to `transparent`
  // (tint lost) instead of a solid block of the tint colour.
  return strip(pa >= pb ? a : b) || null;
}

function transform(css) {
  const lines = css.split('\n'); const out = []; let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = /^(\s*)([-\w]+)\s*:\s*(.*color-mix\(.*;)\s*$/.exec(l);
    const prev = out[out.length - 1] || '';
    if (m && !/nx-fallback/.test(prev) && !/^\s*@supports/.test(l)) {
      const prop = m[2], value = m[3].replace(/;$/, '');
      // replace each color-mix(...) by its first operand
      let fb = value, idx;
      while ((idx = fb.indexOf('color-mix(')) >= 0) {
        const op = pickOperand(fb.slice(idx + 10)); if (!op) { fb = null; break; }
        let depth = 1, j = idx + 10; while (j < fb.length && depth) { depth += fb[j] === '(' ? 1 : fb[j] === ')' ? -1 : 0; j++; }
        fb = fb.slice(0, idx) + op + fb.slice(j);
      }
      if (fb && fb !== value) { out.push(m[1] + prop + ': ' + fb + '; /* nx-fallback: no color-mix() before Chromium 111 */'); n++; }
    }
    out.push(l);
  }
  return { text: out.join('\n'), n };
}

let files = 0, decls = 0, changed = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') { walk(p); } continue; }
    if (!p.endsWith('.css')) { continue; }
    const src = fs.readFileSync(p, 'utf8'); if (!src.includes('color-mix(')) { continue; }
    files++; const r = transform(src); decls += r.n;
    if (r.text !== src) { changed++; if (!check) { fs.writeFileSync(p, r.text); } }
  }
})(root);
console.log((check ? 'would add ' : 'added ') + decls + ' fallback declaration(s) in ' + changed + ' of ' + files + ' css file(s) using color-mix()');
if (check && changed) { process.exit(1); }
