'use strict';
// Smoke test: runs the REAL extension.js against a minimal fake `vscode` API and the REAL Python core.
// Run: node test/smoke.js   (needs Python 3.8+)
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const msgs = [], diags = new Map(), cmds = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nxsmoke-'));
fs.mkdirSync(path.join(tmp, '.nx')); fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true });
fs.writeFileSync(path.join(tmp, '.nx', 'tasks.json'), JSON.stringify({ tasks: { a: { cmd: 'echo A' }, b: { cmd: 'echo B', deps: ['a'] } } }));
fs.writeFileSync(path.join(tmp, '.github', 'workflows', 'ci.yml'),
  'name: ci\non: [push]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "${{ github.event.pull_request.title }}"\n');
fs.writeFileSync(path.join(tmp, 'bad.py'), 'import os\ntry:\n    pass\nexcept:\n    pass\nPASSWORD = "hunter2hunter2"\neval("1")\n');
fs.writeFileSync(path.join(tmp, 'README.md'), 'token = "ghp_' + 'a'.repeat(36) + '"\n');

class Ev { constructor() { this.l = []; this.event = (f) => this.l.push(f); } fire() { this.l.forEach((f) => f()); } }
const vscode = {
  version: 'mock', EventEmitter: Ev, TreeItem: class { constructor(l, s) { this.label = l; this.s = s; } },
  TreeItemCollapsibleState: { None: 0, Expanded: 2 }, ProgressLocation: { Notification: 15 }, StatusBarAlignment: { Left: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 }, DiagnosticSeverity: {},
  Range: class { constructor(...a) { this.a = a; } }, Diagnostic: class { constructor(r, m, s) { this.range = r; this.message = m; this.severity = s; } },
  Uri: { file: (p) => ({ fsPath: p, toString: () => 'file://' + p }) },
  languages: { createDiagnosticCollection: () => ({ clear: () => diags.clear(), set: (u, l) => diags.set(u.fsPath, l), delete: (u) => diags.delete(u.fsPath), dispose() {} }) },
  commands: { registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; }, executeCommand: (id, ...a) => cmds[id] && cmds[id](...a) },
  workspace: { workspaceFolders: [{ uri: { fsPath: tmp } }], isTrusted: true, onDidSaveTextDocument: () => ({}),
    getConfiguration: () => ({ get: (k) => ({ restrictedRun: true, 'claude.enabled': true, pythonPath: '' }[k]) }), openTextDocument: async (o) => o },
  window: { createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }), createStatusBarItem: () => ({ show() {} }),
    registerTreeDataProvider: () => ({}), showInformationMessage: async (m) => { msgs.push(m); }, showWarningMessage: async (m) => { msgs.push(m); },
    showErrorMessage: async (m) => { msgs.push('ERR ' + m); }, setStatusBarMessage() {}, showTextDocument: async () => {}, activeTextEditor: null,
    withProgress: (_o, fn) => fn({ onCancellationRequested() {} }), showQuickPick: async (i) => (Array.isArray(i) ? i[0] : undefined) },
};
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'vscode' ? vscode : orig.call(this, req, ...r); };
const ext = require('../extension.js');

(async () => {
  const pj = require('../package.json');
  ext.activate({ subscriptions: [], secrets: { get: async () => undefined, store: async () => {} }, extension: { packageJSON: pj } });
  // every command declared in package.json must be registered, and vice versa
  const declared = pj.contributes.commands.map((c) => c.command).sort();
  assert.deepStrictEqual(Object.keys(cmds).sort(), declared, 'declared vs registered commands differ');
  await cmds['nx.analyze'](); assert(!msgs.some((m) => m.startsWith('ERR')), msgs.join('|'));
  await cmds['nx.scanSecrets'](); assert(diags.has(path.join(tmp, 'README.md')), 'secret in README not found');
  vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file(path.join(tmp, 'bad.py')) }, selection: { isEmpty: true } };
  await cmds['nx.reviewFile'](); const d = diags.get(path.join(tmp, 'bad.py')) || [];
  assert(d.some((x) => /bare/.test(x.message)) && d.some((x) => /eval/.test(x.message)), 'review findings missing');
  await cmds['nx.pipeline.lint'](); const w = diags.get(path.join(tmp, '.github', 'workflows', 'ci.yml')) || [];
  assert(w.some((x) => /injection/.test(x.message)) && w.some((x) => /pinned/.test(x.message)), 'CI Doctor findings missing');
  await cmds['nx.tasks.run'](); assert(msgs.some((m) => /All tasks ok/.test(m)), 'tasks did not pass: ' + msgs.join('|'));
  assert(!msgs.some((m) => m.startsWith('ERR')), msgs.join('|'));
  console.log('smoke OK: ' + declared.length + ' commands registered; analyze, secrets, review, CI Doctor, task graph verified');
})().catch((e) => { console.error('SMOKE FAIL', e.message, msgs); process.exit(1); });
