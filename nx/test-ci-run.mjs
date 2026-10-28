// Checks nx/ci-run.mjs: exit codes pass through, and a failure prints an escaped ::error annotation with the tail.
import { spawnSync } from 'node:child_process'; import assert from 'node:assert'; import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const script = path.join(import.meta.dirname, 'ci-run.mjs');
const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nxci-')); const okJs = path.join(tmp, 'ok.js'); const badJs = path.join(tmp, 'bad.js');
fs.writeFileSync(okJs, 'console.log("fine")'); fs.writeFileSync(badJs, 'console.log("line1\\nAssertionError: 100% broken"); process.exit(3)');
let r = run('ok step', '--', process.execPath, okJs); assert.strictEqual(r.status, 0); assert.ok(!r.stdout.includes('::error')); assert.ok(r.stdout.includes('fine'));
r = run('bad step', '--', process.execPath, badJs);
assert.strictEqual(r.status, 3); assert.match(r.stdout, /::error title=bad step failed \(exit 3\)::line1%0AAssertionError: 100%25 broken/);
r = run('missing', '--', 'definitely-not-a-command-xyz'); assert.notStrictEqual(r.status, 0); assert.match(r.stdout, /::error title=missing failed/);
assert.strictEqual(run('x').status, 2);
console.log('ci-run OK (4 checks)');
