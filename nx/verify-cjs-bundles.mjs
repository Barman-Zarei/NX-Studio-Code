// Verifies the NX LEGACY node-side bundles: every node entry point must bundle to CommonJS with the real build options,
// contain no `import.meta`, no top-level await, and parse under `node --check`.
// usage: ESBUILD=/path/to/esbuild-package node nx/verify-cjs-bundles.mjs     (Node >= 22.18 or 24; TS is type-stripped)
import { createRequire } from 'node:module'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import cp from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const esbuild = require(process.env.ESBUILD || path.join(root, 'build', 'node_modules', 'esbuild'));
const { getBundleOptions } = await import(path.join(root, 'build/next/bundle.ts'));
const { applyNxLegacy, isNxNodeEntry } = await import(path.join(root, 'build/next/nx-legacy.ts'));
const bootstrap = ['main', 'mainImpl', 'cli', 'bootstrap-fork'];
const entries = [...bootstrap,
  'vs/workbench/contrib/debug/node/telemetryApp', 'vs/platform/files/node/watcher/watcherMain', 'vs/platform/localTranscription/node/localTranscriptionMain',
  'vs/platform/terminal/node/ptyHostMain', 'vs/platform/agentHost/node/agentHostMain', 'vs/platform/agentHost/node/diffWorkerMain',
  'vs/workbench/api/node/extensionHostProcess', 'vs/code/node/cliProcessMain', 'vs/code/electron-utility/sharedProcess/sharedProcessMain'];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nxcjs-')); let bad = 0;
const external = ['./mainImpl.js'];
for (const e of entries) {
  const base = getBundleOptions(false, 'node');
  const o = applyNxLegacy({ ...base, entryPoints: [path.join(root, 'src', e + '.ts')], outfile: path.join(out, e.replace(/\//g, '_') + '.cjs'), write: true, sourcemap: false,
    logLevel: 'silent', external: [...(base.external ?? []), ...(e === 'main' ? external : [])], plugins: [] }, bootstrap.includes(e) || isNxNodeEntry(e) ? 'node' : 'browser');
  try {
    if (!bootstrap.includes(e) && !isNxNodeEntry(e)) { throw new Error('not classified as node entry'); }
    const r = await esbuild.build(o); const f = o.outfile; const src = fs.readFileSync(f, 'utf8');
    const meta = /import\.meta/.test(src);
    const chk = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    const ok = !meta && chk.status === 0;
    console.log((ok ? 'OK   ' : 'FAIL ') + e + '  ' + (src.length / 1024 | 0) + ' KiB' + (meta ? '  [import.meta left]' : '') + (chk.status ? '  [node --check: ' + chk.stderr.split('\n')[0] + ']' : ''));
    if (!ok) { bad++; }
  } catch (err) { bad++; console.log('FAIL ' + e + '  ' + String(err.message).split('\n').slice(0, 2).join(' | ')); }
}
console.log(bad ? bad + ' entry point(s) failed' : 'all ' + entries.length + ' node entry points bundle to valid CommonJS');
process.exit(bad ? 1 : 0);
