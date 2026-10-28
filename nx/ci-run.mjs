// Runs a command, streams its output, and on failure prints the last lines as a GitHub `::error` annotation.
// Annotations are shown on the public run page, so failures can be read without signing in to view the raw logs.
// usage: node nx/ci-run.mjs "<title>" -- <command> [args...]
import { spawn } from 'node:child_process';
const argv = process.argv.slice(2); const sep = argv.indexOf('--');
if (sep < 1 || sep === argv.length - 1) { console.error('usage: ci-run.mjs "<title>" -- <command> [args...]'); process.exit(2); }
const title = argv.slice(0, sep).join(' '); const [cmd, ...args] = argv.slice(sep + 1);
const TAIL = 40; const tail = [];
const keep = (chunk) => { for (const l of String(chunk).split(/\r?\n/)) { if (l.trim()) { tail.push(l); if (tail.length > TAIL) { tail.shift(); } } } };
const win = process.platform === 'win32'; // npm/yarn are .cmd files on Windows: they need a shell, which needs quoted arguments
const q = (a) => (win && /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
const child = spawn(q(cmd), args.map(q), { stdio: ['inherit', 'pipe', 'pipe'], shell: win });
child.stdout.on('data', (d) => { process.stdout.write(d); keep(d); }); child.stderr.on('data', (d) => { process.stderr.write(d); keep(d); });
child.on('error', (e) => { keep(String(e.message)); finish(127); });
child.on('close', (code, signal) => finish(code ?? (signal ? 1 : 0)));
let done = false;
function finish(code) {
	if (done) { return; } done = true;
	if (code !== 0) {
		const text = tail.map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(0, 300)).join('\n');
		const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
		process.stdout.write(`\n::error title=${esc(title)} failed (exit ${code})::${esc(text)}\n`);
	}
	process.exit(code);
}
