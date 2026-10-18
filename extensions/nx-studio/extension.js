'use strict';
/**
 * NX Studio (built-in extension of NX Studio Code 1.0.0, author: Barman).
 * Plain CommonJS on purpose: no build step, works on the LEGACY (VS Code 1.70 / Electron 18 / Node 16) and main lines.
 * All heavy lifting is done by the Python core in ./python/nxcs through `python -m nxcs.bridge <method>`.
 */
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const NX_VERSION = '1.0.0';
const PY_DIR = path.join(__dirname, 'python');
let out, diag, statusItem, ctx, pyCache = null, previewServer = null;
const cache = { analysis: null, workflows: [], tasks: {} };
const emitters = { project: new vscode.EventEmitter(), pipelines: new vscode.EventEmitter(), tasks: new vscode.EventEmitter() };

// ------------------------------------------------------------------ helpers
const cfg = () => vscode.workspace.getConfiguration('nx');
const log = (s) => out.appendLine(s);

function root() {
  const f = vscode.workspace.workspaceFolders;
  if (!f || !f.length) { throw new Error('Open a folder first.'); }
  return f[0].uri.fsPath;
}

function requireTrust() {
  if (vscode.workspace.isTrusted === false) {
    throw new Error('This workspace is not trusted. Trust it to run pipelines, tests, tasks or git commands.');
  }
}

function execFileP(cmd, args, opts) {
  return new Promise((res, rej) => cp.execFile(cmd, args, Object.assign({ timeout: 15000 }, opts), (e, so, se) => (e ? rej(e) : res(so + se))));
}

async function findPython() {
  if (pyCache) { return pyCache; }
  const cands = [];
  const user = cfg().get('pythonPath');
  if (user) { cands.push([user, []]); }
  cands.push(['python3', []], ['python', []]);
  if (process.platform === 'win32') { cands.push(['py', ['-3']]); }
  for (const [cmd, pre] of cands) {
    try {
      const o = await execFileP(cmd, pre.concat(['-c', 'import sys;print(int(sys.version_info>=(3,8)))']));
      if (o.trim() === '1') { pyCache = { cmd, pre }; return pyCache; }
    } catch (e) { /* try next */ }
  }
  throw new Error('Python 3.8+ was not found. Install it, or set "nx.pythonPath" in settings.');
}

/** Call a bridge method. onEvent receives streamed {event:...} objects. token (optional) cancels. */
async function call(method, args, opts) {
  opts = opts || {};
  const py = await findPython();
  const env = Object.assign({}, process.env, { PYTHONPATH: PY_DIR, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' });
  if (method.indexOf('claude.') === 0 || method.indexOf('agent.') === 0) {
    const key = await ctx.secrets.get('nx.anthropic');
    if (key) { env.ANTHROPIC_API_KEY = key; }
  }
  return new Promise((resolve, reject) => {
    const child = cp.spawn(py.cmd, py.pre.concat(['-m', 'nxcs.bridge', method]), { cwd: PY_DIR, env, windowsHide: true });
    let buf = '', err = '', final = null;
    const take = (line) => {
      if (!line.trim()) { return; }
      let o; try { o = JSON.parse(line); } catch (e) { return; }
      if (o.event) { if (opts.onEvent) { opts.onEvent(o); } } else { final = o; }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', () => {
      take(buf);
      if (!final) { return reject(new Error('NX core produced no result. ' + err.slice(-400))); }
      if (final.ok) { resolve(final.result); } else { const e = new Error(final.error); e.kind = final.kind; reject(e); }
    });
    if (opts.token) { opts.token.onCancellationRequested(() => { try { child.kill(); } catch (e) { /* ignore */ } }); }
    child.stdin.write(JSON.stringify(args || {})); child.stdin.end();
  });
}

async function guard(fn) {
  try { return await fn(); } catch (e) { log('[error] ' + (e.kind ? e.kind + ': ' : '') + e.message); vscode.window.showErrorMessage('NX: ' + e.message); }
}

async function openDoc(content, language) {
  const d = await vscode.workspace.openTextDocument({ content, language: language || 'markdown' });
  await vscode.window.showTextDocument(d, { preview: false });
}

const SEV = { error: 0, security: 0, warning: 1, maintainability: 2, info: 2 };
function toDiagnostics(findings, baseDir) {
  const map = new Map();
  for (const f of findings) {
    const file = path.isAbsolute(f.file) ? f.file : path.join(baseDir, f.file);
    const line = Math.max(0, (f.line || 1) - 1);
    const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), f.msg, SEV[f.severity] !== undefined ? SEV[f.severity] : 2);
    d.source = 'NX'; d.code = f.severity;
    const k = vscode.Uri.file(file).toString();
    if (!map.has(k)) { map.set(k, { uri: vscode.Uri.file(file), list: [] }); }
    map.get(k).list.push(d);
  }
  return map;
}
function publish(findings, baseDir, replaceAll) {
  if (replaceAll) { diag.clear(); }
  for (const { uri, list } of toDiagnostics(findings, baseDir).values()) { diag.set(uri, list); }
}

function workflows() {
  const dir = path.join(root(), '.github', 'workflows');
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join(dir, f));
}

async function pickWorkflow() {
  const w = workflows();
  if (!w.length) { throw new Error('No workflows in .github/workflows'); }
  if (w.length === 1) { return w[0]; }
  const p = await vscode.window.showQuickPick(w.map((f) => ({ label: path.basename(f), f })), { placeHolder: 'Workflow' });
  return p && p.f;
}

function withProgress(title, fn) {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (_p, token) => fn(token));
}

// ------------------------------------------------------------------ commands
const C = {};

C['nx.about'] = () => guard(async () => {
  let core = 'Python core unavailable';
  try { const p = await call('ping', {}); core = 'core ' + p.nxcs + ' on Python ' + p.python + (p.bash ? '' : ' (bash missing)') + (p.git ? '' : ' (git missing)'); } catch (e) { core = e.message; }
  vscode.window.showInformationMessage('NX Studio Code ' + NX_VERSION + ' by Barman — engine VS Code ' + vscode.version + ' — ' + core);
});

C['nx.analyze'] = () => guard(async () => {
  const a = await call('analyze', { root: root() });
  cache.analysis = a; emitters.project.fire();
  log('[analyze] ' + JSON.stringify(a, null, 2)); out.show(true);
});

C['nx.reviewFile'] = () => guard(async () => {
  const ed = vscode.window.activeTextEditor; if (!ed) { throw new Error('No active file.'); }
  const p = ed.document.uri.fsPath;
  const f = await call('review', { path: p });
  diag.delete(ed.document.uri); publish(f, path.dirname(p), false);
  vscode.window.setStatusBarMessage('NX review: ' + f.length + ' confirmed finding(s)', 4000);
});

C['nx.scanSecrets'] = () => guard(async () => {
  const f = await call('secrets', { root: root() });
  publish(f, root(), true);
  log('[secrets] ' + f.length + ' candidate(s) (heuristic; masked)');
  vscode.window.showInformationMessage('NX Secret Scanner: ' + f.length + ' candidate(s). See Problems panel.');
});

C['nx.runTests'] = () => guard(async () => {
  requireTrust();
  const r = await withProgress('NX: running tests', (token) => call('test.run', { root: root() }, { token }));
  log(r.output); out.show(true);
  const f = (r.locations || []).filter((l) => l[0].indexOf(root()) === 0).map((l) => ({ file: l[0], line: l[1], severity: 'error', msg: 'test failure trace' }));
  publish(f, root(), true);
  const msg = 'NX tests: ran ' + r.ran + ', failed ' + r.failed.length + ', skipped ' + r.skipped;
  (r.ok ? vscode.window.showInformationMessage : vscode.window.showWarningMessage)(msg);
});

function streamTo(token) {
  return (o) => {
    if (o.event === 'output') { out.append('[' + o.job + '] ' + o.data); }
    if (o.event === 'job') { log('== job ' + o.job + ': ' + o.status); }
  };
}

C['nx.pipeline.run'] = () => guard(async () => {
  requireTrust();
  const wf = await pickWorkflow(); if (!wf) { return; }
  const info = await call('pipeline.inspect', { path: wf });
  const names = Object.keys(info.jobs);
  const picks = await vscode.window.showQuickPick(names.map((n) => ({ label: n, description: (info.jobs[n].needs.length ? 'needs ' + info.jobs[n].needs.join(', ') : ''), picked: true })),
    { canPickMany: true, placeHolder: 'Jobs to run (dependencies are added automatically)' });
  if (!picks || !picks.length) { return; }
  out.show(true); log('== Pipeline Lab: ' + path.basename(wf));
  const r = await withProgress('NX Pipeline Lab', (token) => call('pipeline.run',
    { path: wf, jobs: picks.map((p) => p.label), cwd: root(), restricted: cfg().get('restrictedRun') }, { token, onEvent: streamTo(token) }));
  log('== result: ' + JSON.stringify(r.status));
  if (r.unsupported.length) { log('== NOT executed locally (honest report):\n  - ' + r.unsupported.join('\n  - ')); }
  const bad = Object.keys(r.status).filter((k) => r.status[k] !== 'ok');
  (bad.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(bad.length ? 'Pipeline: not ok → ' + bad.join(', ') : 'Pipeline: all jobs ok (run: steps only)');
});

C['nx.pipeline.inspect'] = () => guard(async () => {
  const wf = await pickWorkflow(); if (!wf) { return; }
  const i = await call('pipeline.inspect', { path: wf });
  log('[inspect ' + path.basename(wf) + '] ' + JSON.stringify(i, null, 2)); out.show(true);
});

C['nx.pipeline.lint'] = () => guard(async () => {
  let all = []; diag.clear();
  for (const w of workflows()) { all = all.concat(await call('pipeline.lint', { path: w })); }
  publish(all, root(), false);
  vscode.window.showInformationMessage('NX CI Doctor: ' + all.length + ' finding(s) in ' + workflows().length + ' workflow(s). See Problems panel.');
});

C['nx.tasks.init'] = () => guard(async () => {
  const dir = path.join(root(), '.nx'); const f = path.join(dir, 'tasks.json');
  if (fs.existsSync(f)) { throw new Error('.nx/tasks.json already exists'); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ tasks: { lint: { cmd: 'echo lint' }, test: { cmd: 'echo test', deps: ['lint'] }, build: { cmd: 'echo build', deps: ['test'] } } }, null, 2) + '\n');
  await vscode.window.showTextDocument(vscode.Uri.file(f)); emitters.tasks.fire();
});

C['nx.tasks.run'] = () => guard(async () => {
  requireTrust();
  out.show(true); log('== Task Graph');
  const r = await withProgress('NX Task Graph', (token) => call('tasks.run', { root: root() }, { token, onEvent: streamTo(token) }));
  log('== result: ' + JSON.stringify(r.status));
  const bad = Object.keys(r.status).filter((k) => r.status[k] !== 'ok');
  (bad.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(bad.length ? 'Tasks not ok: ' + bad.join(', ') : 'All tasks ok');
});

function projectVersion() {
  const pj = path.join(root(), 'package.json');
  if (fs.existsSync(pj)) { try { return JSON.parse(fs.readFileSync(pj, 'utf8')).version; } catch (e) { /* ignore */ } }
  const py = path.join(root(), 'pyproject.toml');
  if (fs.existsSync(py)) { const m = /^version\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(py, 'utf8')); if (m) { return m[1]; } }
  return undefined;
}

C['nx.release'] = () => guard(async () => {
  let v = projectVersion();
  if (!v) { v = await vscode.window.showInputBox({ prompt: 'Current version (x.y.z)', value: '0.1.0' }); }
  if (!v) { return; }
  const part = await vscode.window.showQuickPick(['patch', 'minor', 'major'], { placeHolder: 'Version bump (current ' + v + ')' });
  if (!part) { return; }
  const since = await vscode.window.showInputBox({ prompt: 'Changelog since git ref/tag (empty = whole history)' });
  const r = await call('release', { root: root(), version: v, part, since: since || null, tests_ok: false });
  const md = '# Release Pilot\n\nCurrent `' + v + '` → proposed **' + r.next + '**\n\n## Changelog\n' + r.changelog +
    '\n## Checklist\n' + r.checklist.map((c) => '- [' + (c[1] ? 'x' : ' ') + '] ' + c[0]).join('\n') +
    '\n\n> Release Pilot never tags, pushes or publishes. Tests are marked unchecked until you run them.\n';
  await openDoc(md);
});

C['nx.git'] = () => guard(async () => {
  requireTrust();
  const R = root();
  const g = (name, extra) => call('git.' + name, Object.assign({ root: R }, extra || {}));
  const act = await vscode.window.showQuickPick(['status', 'diff', 'diff (staged)', 'stage all', 'commit', 'log', 'branches', 'new branch', 'switch branch',
    'conflicts', 'merge', 'discard file changes ⚠', 'delete branch ⚠', 'push ⚠'], { placeHolder: 'Git Command Center' });
  if (!act) { return; }
  const show = (t) => { log('[git ' + act + ']\n' + (typeof t === 'string' ? t : JSON.stringify(t, null, 2))); out.show(true); };
  const confirm = async (m, b) => (await vscode.window.showWarningMessage(m, { modal: true }, b)) === b;
  switch (act) {
    case 'status': show(await g('status')); break;
    case 'diff': show(await g('diff')); break;
    case 'diff (staged)': show(await g('diff', { staged: true })); break;
    case 'stage all': await g('stage', { paths: ['.'] }); show('staged'); break;
    case 'commit': { const m = await vscode.window.showInputBox({ prompt: 'Commit message' }); if (m) { show('commit ' + await g('commit', { message: m })); } break; }
    case 'log': show((await g('log', { n: 20 })).join('\n')); break;
    case 'branches': show((await g('branches')).join('\n')); break;
    case 'new branch': { const n = await vscode.window.showInputBox({ prompt: 'New branch name' }); if (n) { await g('create_branch', { name: n }); show('on ' + n); } break; }
    case 'switch branch': { const n = await vscode.window.showQuickPick(await g('branches')); if (n) { await g('switch', { name: n }); show('on ' + n); } break; }
    case 'conflicts': show(await g('conflicts')); break;
    case 'merge': { const n = await vscode.window.showQuickPick(await g('branches'), { placeHolder: 'Merge into current' }); if (n) { show(await g('merge', { name: n })); } break; }
    case 'discard file changes ⚠': { const p = await vscode.window.showInputBox({ prompt: 'File path (relative) to discard' });
      if (p && await confirm('Discard ALL uncommitted changes in ' + p + '? This cannot be undone.', 'Discard')) { await g('discard', { path: p, confirm: true }); show('discarded ' + p); } break; }
    case 'delete branch ⚠': { const n = await vscode.window.showQuickPick(await g('branches'), { placeHolder: 'Delete (only if merged)' });
      if (n && await confirm('Delete branch ' + n + '?', 'Delete')) { await g('delete_branch', { name: n, confirm: true }); show('deleted ' + n); } break; }
    case 'push ⚠': { const force = (await vscode.window.showQuickPick(['normal push', 'force-with-lease push'], { placeHolder: 'Push mode' })) === 'force-with-lease push';
      if (await confirm((force ? 'FORCE ' : '') + 'push to origin?', 'Push')) { await g('push', { remote: 'origin', force, confirm: true }); show('pushed'); } break; }
    default: break;
  }
});

C['nx.deps'] = () => guard(async () => {
  const r = await withProgress('NX Dependency Guardian (needs network)', () => call('deps.outdated', {}));
  if (!r.ok) { throw new Error('pip failed: ' + r.error); }
  const items = await Promise.all(r.packages.map(async (p) => { const v = await call('deps.preview', { name: p[0], current: p[1], latest: p[2] }); return { label: p[0], description: p[1] + ' → ' + p[2], detail: v.risk }; }));
  log('[deps] ' + items.length + ' outdated; security advisories: UNAVAILABLE (no advisory DB bundled)');
  await vscode.window.showQuickPick(items.length ? items : [{ label: 'Everything is up to date' }], { placeHolder: 'Outdated packages (advisories unavailable)' });
});

C['nx.forge'] = () => guard(async () => {
  const kind = await vscode.window.showQuickPick(['python', 'cli', 'web', 'c'], { placeHolder: 'Project type' }); if (!kind) { return; }
  const name = await vscode.window.showInputBox({ prompt: 'Project name (letters, digits, _)', validateInput: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? null : 'use letters, digits, underscore') }); if (!name) { return; }
  const dir = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Create here' }); if (!dir) { return; }
  const dest = path.join(dir[0].fsPath, name);
  await call('forge', { kind, dest, name });
  if ((await vscode.window.showInformationMessage('Created ' + dest, 'Open')) === 'Open') { vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dest)); }
});

C['nx.logs'] = () => guard(async () => {
  const ed = vscode.window.activeTextEditor; if (!ed) { throw new Error('No active file.'); }
  const lvl = await vscode.window.showQuickPick(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'], { placeHolder: 'Minimum level' }); if (!lvl) { return; }
  const pat = await vscode.window.showInputBox({ prompt: 'Regex filter (optional)' });
  const san = (await vscode.window.showQuickPick(['sanitize for sharing', 'keep as is'], { placeHolder: 'Redact secrets/paths?' })) === 'sanitize for sharing';
  const r = await call('logs', { text: ed.document.getText(), min_level: lvl, pattern: pat || null, sanitize: san });
  await openDoc(r.map((x) => x[1]).join('\n'), 'log');
});

C['nx.profile'] = () => guard(async () => {
  requireTrust();
  const ed = vscode.window.activeTextEditor; if (!ed || ed.document.languageId !== 'python') { throw new Error('Open a Python file.'); }
  const r = await withProgress('NX Profiler', (t) => call('profile', { path: ed.document.uri.fsPath, top: 20 }, { token: t }));
  log('[profile] ' + r.seconds + 's, peak ' + r.peak_kib + ' KiB' + (r.error ? ', error: ' + r.error : '') + '\n' + r.top.map((x) => x.cum_s + 's  ' + x.calls + 'x  ' + x.function).join('\n')); out.show(true);
});

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
C['nx.preview'] = () => guard(async () => {
  if (previewServer) { previewServer.close(); previewServer = null; vscode.window.showInformationMessage('NX Live Preview stopped.'); return; }
  const base = path.resolve(root());
  previewServer = http.createServer((req, res) => {
    let p = path.normalize(path.join(base, decodeURIComponent(req.url.split('?')[0])));
    if (p.indexOf(base) !== 0) { res.writeHead(403); return res.end('forbidden'); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) { p = path.join(p, 'index.html'); }
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
  });
  await new Promise((r) => previewServer.listen(0, '127.0.0.1', r)); // 127.0.0.1 ONLY
  const url = 'http://127.0.0.1:' + previewServer.address().port + '/';
  log('[preview] ' + url); vscode.commands.executeCommand('simpleBrowser.show', url);
});

// Studio profiles map to REAL VS Code settings. 'low-resource' and 'legacy-safe' target weak/old hardware.
const PROFILES = {
  python: { 'editor.tabSize': 4, 'editor.formatOnSave': true, 'files.eol': '\n' },
  web: { 'editor.tabSize': 2, 'editor.formatOnSave': true, 'files.eol': '\n' },
  cpp: { 'editor.tabSize': 4, 'editor.formatOnSave': false },
  'low-resource': { 'editor.minimap.enabled': false, 'editor.smoothScrolling': false, 'editor.cursorSmoothCaretAnimation': 'off', 'workbench.list.smoothScrolling': false,
    'editor.bracketPairColorization.enabled': false, 'editor.guides.bracketPairs': false, 'editor.semanticHighlighting.enabled': false, 'files.watcherExclude': { '**/node_modules/**': true, '**/.git/objects/**': true },
    'search.followSymlinks': false, 'extensions.autoCheckUpdates': false, 'terminal.integrated.gpuAcceleration': 'off', 'workbench.enableExperiments': false },
  'legacy-safe': { 'terminal.integrated.gpuAcceleration': 'off', 'editor.smoothScrolling': false, 'workbench.reduceMotion': 'on', 'window.titleBarStyle': 'native',
    'editor.minimap.enabled': false, 'editor.renderLineHighlight': 'line' },
  offline: { 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'workbench.enableExperiments': false,
    'workbench.settings.enableNaturalLanguageSearch': false, 'npm.fetchOnlinePackageInfo': false, 'git.autofetch': false },
};
C['nx.studioProfile'] = () => guard(async () => {
  const name = await vscode.window.showQuickPick(Object.keys(PROFILES), { placeHolder: 'Studio profile' }); if (!name) { return; }
  const scope = await vscode.window.showQuickPick(['User settings', 'Workspace settings'], { placeHolder: 'Apply to' }); if (!scope) { return; }
  const target = scope === 'User settings' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
  for (const [k, v] of Object.entries(PROFILES[name])) {
    const i = k.lastIndexOf('.'); await vscode.workspace.getConfiguration(k.slice(0, i)).update(k.slice(i + 1), v, target);
  }
  vscode.window.showInformationMessage('Studio profile "' + name + '" applied to ' + scope + '.');
});

function parseJsonc(t) {
  return JSON.parse(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1') || '{}');
}
function argvPath() { return path.join(os.homedir(), '.nx-studio-code', 'argv.json'); }

C['nx.safeGraphics'] = () => guard(async () => {
  const f = argvPath(); let cur = {};
  if (fs.existsSync(f)) { try { cur = parseJsonc(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error('Cannot parse ' + f + ': ' + e.message); } fs.copyFileSync(f, f + '.bak'); }
  const on = !cur['disable-hardware-acceleration'];
  cur['disable-hardware-acceleration'] = on;
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(cur, null, 2) + '\n');
  const b = await vscode.window.showInformationMessage('Safe Graphics Mode ' + (on ? 'ENABLED' : 'disabled') + ' (software rendering). Restart NX Studio Code to apply.', 'Restart now');
  if (b) { vscode.commands.executeCommand('workbench.action.reloadWindow'); }
});

C['nx.doctor'] = () => guard(async () => {
  const mem = os.totalmem() / 1073741824, cpus = os.cpus();
  const win7 = process.platform === 'win32' && /^6\.1/.test(os.release());
  let py = 'not found'; try { const p = await call('ping', {}); py = p.python + ' (core ' + p.nxcs + ', bash:' + p.bash + ', git:' + p.git + ')'; } catch (e) { py = e.message; }
  const tips = [];
  if (mem < 4) { tips.push('RAM < 4 GB → apply Studio Profile **low-resource**.'); }
  if (cpus.length <= 2) { tips.push('≤ 2 CPU threads → apply **low-resource**; disable heavy extensions.'); }
  if (win7) { tips.push('Windows 7 detected → use the **LEGACY** build; apply **legacy-safe**; if the window is blank/glitchy run **Safe Graphics Mode**.'); }
  if (process.arch === 'ia32') { tips.push('32-bit process: large workspaces are limited to ~2–3 GB of memory.'); }
  if (!tips.length) { tips.push('No problems detected.'); }
  await openDoc('# NX Compatibility Doctor\n\n- NX Studio Code: ' + NX_VERSION + '\n- Engine: VS Code ' + vscode.version + ' (Electron ' + (process.versions.electron || '?') + ', Node ' + process.versions.node + ')\n- OS: ' +
    process.platform + ' ' + os.release() + ' ' + process.arch + (win7 ? ' (Windows 7)' : '') + '\n- CPU: ' + (cpus[0] ? cpus[0].model : '?') + ' x' + cpus.length + '\n- RAM: ' + mem.toFixed(1) + ' GB\n- Python: ' + py + '\n\n## Recommendations\n' + tips.map((t) => '- ' + t).join('\n') +
    '\n\n> Limits: GPU model/driver and CPU instruction sets (SSE3/AVX) cannot be read from an extension; if the editor fails to start on very old hardware use `nx-studio-code-safe` launcher.\n');
});

C['nx.claude.setKey'] = () => guard(async () => {
  const k = await vscode.window.showInputBox({ prompt: 'Anthropic API key (stored in the OS keychain via SecretStorage)', password: true, ignoreFocusOut: true });
  if (k) { await ctx.secrets.store('nx.anthropic', k.trim()); vscode.window.showInformationMessage('Claude API key saved.'); }
});

function claudeOn() { if (!cfg().get('claude.enabled')) { throw new Error('Claude features are disabled (nx.claude.enabled).'); } }

C['nx.claude.ask'] = () => guard(async () => {
  claudeOn();
  const prompt = await vscode.window.showInputBox({ prompt: 'Ask Claude' }); if (!prompt) { return; }
  const ed = vscode.window.activeTextEditor;
  const sel = ed && !ed.selection.isEmpty ? '\n\n--- selection ---\n' + ed.document.getText(ed.selection) : '';
  const r = await withProgress('Claude', (token) => call('claude.ask', { prompt: prompt + sel, model: cfg().get('claude.model') }, { token }));
  await openDoc('<!-- source: ' + r.source + ', model: ' + r.model + ' -->\n\n' + r.text);
});

C['nx.agent'] = () => guard(async () => {
  claudeOn(); requireTrust();
  const ed = vscode.window.activeTextEditor; if (!ed) { throw new Error('No active file.'); }
  if (ed.document.isDirty) { throw new Error('Save the file first (the agent works from the on-disk text).'); }
  const abs = ed.document.uri.fsPath, rel = path.relative(root(), abs);
  if (rel.indexOf('..') === 0) { throw new Error('File is outside the workspace.'); }
  const task = await vscode.window.showInputBox({ prompt: 'What should change in ' + rel + '?' }); if (!task) { return; }
  const p = await withProgress('Claude Project Agent: drafting', (token) => call('agent.propose', { root: root(), rel_path: rel, task, model: cfg().get('claude.model') }, { token }));
  if (!p.diff) { vscode.window.showInformationMessage('Agent proposed no changes.'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-agent-'));
  const a = path.join(tmp, 'current-' + path.basename(abs)), b = path.join(tmp, 'proposed-' + path.basename(abs));
  fs.writeFileSync(a, p.base_text); fs.writeFileSync(b, p.new_text);
  await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(a), vscode.Uri.file(b), 'NX Agent proposal for ' + rel + ' [source: ' + p.source + ']');
  const ok = await vscode.window.showWarningMessage('Apply the proposed changes to ' + rel + '? Nothing has been written yet.', { modal: true }, 'Apply');
  if (ok !== 'Apply') { log('[agent] rejected'); return; }
  const r = await call('patch.apply', { path: abs, base_text: p.base_text, new_text: p.new_text });
  if (!r.applied) { throw new Error('Not applied: ' + r.reason); }
  vscode.window.showInformationMessage('Applied. Run NX: Run Tests to verify.');
});

C['nx.refresh'] = () => guard(async () => {
  try { cache.analysis = await call('analyze', { root: root() }); } catch (e) { cache.analysis = null; }
  try { cache.tasks = await call('tasks.list', { root: root() }); } catch (e) { cache.tasks = {}; }
  try { cache.workflows = []; for (const w of workflows()) { cache.workflows.push({ file: w, info: await call('pipeline.inspect', { path: w }) }); } } catch (e) { cache.workflows = []; }
  emitters.project.fire(); emitters.pipelines.fire(); emitters.tasks.fire();
});

C['nx.menu'] = async () => {
  const items = ctx.extension.packageJSON.contributes.commands.filter((c) => c.command !== 'nx.menu').map((c) => ({ label: c.title, command: c.command }));
  const p = await vscode.window.showQuickPick(items, { placeHolder: 'NX Studio Code ' + NX_VERSION });
  if (p) { vscode.commands.executeCommand(p.command); }
};

// ------------------------------------------------------------------ tree views
const item = (label, desc, children, cmd) => {
  const t = new vscode.TreeItem(label, children && children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
  t.description = desc; t.children = children; if (cmd) { t.command = cmd; } return t;
};
function provider(emitter, build) {
  return { onDidChangeTreeData: emitter.event, getTreeItem: (e) => e, getChildren: (e) => (e ? e.children || [] : build()) };
}
const projectTree = () => {
  const a = cache.analysis; if (!a) { return [item('Run "NX: Analyze Project"', '', null, { command: 'nx.analyze', title: 'Analyze' })]; }
  return [item('Languages', '', Object.entries(a.languages).map(([k, v]) => item(k, String(v)))),
    item('Entry points', '', a.entry_points.map((e) => item(e))), item('Build files', '', a.build_files.map((e) => item(e))),
    item('Dependencies', '', Object.entries(a.dependencies).map(([k, v]) => item(k, v.length + ' pkg')))];
};
const pipelineTree = () => (cache.workflows.length ? cache.workflows.map((w) => item(path.basename(w.file), '',
  Object.keys(w.info.jobs || {}).map((j) => item(j, (w.info.jobs[j].needs || []).length ? 'needs ' + w.info.jobs[j].needs.join(',') : '')), null)) :
  [item('No workflows (.github/workflows)', '')]);
const taskTree = () => (Object.keys(cache.tasks).length ? Object.entries(cache.tasks).map(([n, d]) => item(n, d.length ? 'after ' + d.join(', ') : '', null, { command: 'nx.tasks.run', title: 'Run' })) :
  [item('Create .nx/tasks.json', '', null, { command: 'nx.tasks.init', title: 'Init' })]);

// ------------------------------------------------------------------ lifecycle
function activate(context) {
  ctx = context;
  out = vscode.window.createOutputChannel('NX Studio'); diag = vscode.languages.createDiagnosticCollection('nx');
  context.subscriptions.push(out, diag);
  for (const [id, fn] of Object.entries(C)) { context.subscriptions.push(vscode.commands.registerCommand(id, fn)); }
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusItem.text = '$(rocket) NX ' + NX_VERSION; statusItem.tooltip = 'NX Studio Code — click for commands'; statusItem.command = 'nx.menu'; statusItem.show();
  context.subscriptions.push(statusItem);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('nx.project', provider(emitters.project, projectTree)),
    vscode.window.registerTreeDataProvider('nx.pipelines', provider(emitters.pipelines, pipelineTree)),
    vscode.window.registerTreeDataProvider('nx.tasks', provider(emitters.tasks, taskTree)));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((d) => {
    if (cfg().get('reviewOnSave') && d.languageId === 'python' && vscode.workspace.isTrusted !== false) { vscode.commands.executeCommand('nx.reviewFile'); }
  }));
  if (vscode.workspace.workspaceFolders && vscode.workspace.isTrusted !== false) { C['nx.refresh'](); }
}

function deactivate() { if (previewServer) { previewServer.close(); } }

module.exports = { activate, deactivate };
