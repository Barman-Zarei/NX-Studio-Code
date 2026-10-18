// Tests the LEGACY fetch implementation (real HTTP server + files) and the Electron protocol shim (fake Protocol).
// usage: node nx/test-compat.mjs    (Node >= 22.18 / 24: TypeScript is type-stripped)
import http from 'node:http'; import zlib from 'node:zlib'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert'; import { pathToFileURL } from 'node:url'; import { Readable } from 'node:stream';
import { register } from 'node:module'; register('./ts-resolve-hooks.mjs', import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { nxFetch, NxResponse, NxHeaders, NxRequest, installFetch } = await import(path.join(root, 'src/nx-compat/fetch-node.ts'));
const { patchProtocol } = await import(path.join(root, 'src/nx-compat/electron-shims.ts'));
let n = 0; const ok = (m) => { n++; };

const server = http.createServer((req, res) => {
	if (req.url === '/hello') { res.setHeader('content-type', 'text/plain'); return res.end('hello'); }
	if (req.url === '/gz') { res.writeHead(200, { 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync('zipped')); }
	if (req.url === '/redir') { res.writeHead(302, { location: '/hello' }); return res.end(); }
	if (req.url === '/echo') { const c = []; req.on('data', (d) => c.push(d)); return req.on('end', () => res.end(JSON.stringify({ m: req.method, b: Buffer.concat(c).toString(), h: req.headers['x-t'] }))); }
	if (req.url === '/slow') { return setTimeout(() => res.end('late'), 2000); }
	res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;

assert.strictEqual(await (await nxFetch(base + '/hello')).text(), 'hello'); ok();
assert.strictEqual(await (await nxFetch(base + '/gz')).text(), 'zipped'); ok();
const rd = await nxFetch(base + '/redir'); assert.strictEqual(await rd.text(), 'hello'); ok();
assert.strictEqual((await nxFetch(base + '/redir', { redirect: 'manual' })).status, 302); ok();
assert.deepStrictEqual(await (await nxFetch(base + '/echo', { method: 'POST', body: 'abc', headers: { 'X-T': '1' } })).json(), { m: 'POST', b: 'abc', h: '1' }); ok();
assert.strictEqual((await nxFetch(base + '/nope')).status, 404); ok();
const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
await assert.rejects(nxFetch(base + '/slow', { signal: ac.signal }), (e) => e.name === 'AbortError' || /abort/i.test(String(e))); ok();
await assert.rejects(nxFetch('http://127.0.0.1:1/'), /fetch failed/); ok();
server.closeAllConnections?.(); server.close();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxf-')); const f = path.join(dir, 'a b.txt'); fs.writeFileSync(f, '0123456789');
const fu = pathToFileURL(f).toString();
assert.strictEqual(await (await nxFetch(fu)).text(), '0123456789'); ok();
const part = await nxFetch(fu, { headers: { Range: 'bytes=2-5' } }); assert.strictEqual(part.status, 206); assert.strictEqual(part.headers.get('content-range'), 'bytes 2-5/10'); assert.strictEqual(await part.text(), '2345'); ok();
assert.strictEqual(await (await nxFetch(fu, { headers: { Range: 'bytes=-3' } })).text(), '789'); ok();
assert.strictEqual((await nxFetch(fu, { headers: { Range: 'bytes=50-' } })).status, 416); ok();
assert.strictEqual((await nxFetch(pathToFileURL(path.join(dir, 'missing')).toString())).status, 404); ok();
assert.strictEqual(await (await nxFetch('data:text/plain;base64,aGk=')).text(), 'hi'); ok();
const h = new NxHeaders({ 'Content-Type': 'a' }); h.append('x', '1'); h.append('X', '2'); assert.strictEqual(h.get('content-type'), 'a'); assert.strictEqual(h.get('x'), '1, 2'); ok();
const r = new NxResponse('x'); await r.text(); await assert.rejects(r.text(), /already been read/); ok();
const g = {}; installFetch(g); assert.strictEqual(typeof g.fetch, 'function'); const g2 = { fetch: 1 }; installFetch(g2); assert.strictEqual(g2.fetch, 1); ok();

// ---- protocol shim with a fake Electron Protocol
const calls = []; const P = {
	registerStreamProtocol(s, cb) { calls.push(['register', s]); this.cb = cb; return true; },
	interceptStreamProtocol(s, cb) { calls.push(['intercept', s]); this.icb = cb; return true; },
	unregisterProtocol(s) { calls.push(['unregister', s]); return true; }, uninterceptProtocol(s) { calls.push(['unintercept', s]); return true; },
	isProtocolRegistered: () => true, isProtocolIntercepted: () => false,
};
assert.strictEqual(patchProtocol(P), true); assert.strictEqual(patchProtocol(P), false); ok();
P.handle('vscode-file', async (req) => new NxResponse(JSON.stringify({ url: req.url, m: req.method, b: req.body?.toString() }), { status: 201, headers: { 'content-type': 'application/json' } }));
const out = await new Promise((res) => P.cb({ url: 'vscode-file://vscode-app/x.js', method: 'POST', headers: { a: 'b' }, uploadData: [{ bytes: Buffer.from('payload') }] }, res));
assert.strictEqual(out.statusCode, 201); assert.strictEqual(out.headers['content-type'], 'application/json');
let body = ''; for await (const c of out.data) { body += c; } assert.deepStrictEqual(JSON.parse(body), { url: 'vscode-file://vscode-app/x.js', m: 'POST', b: 'payload' }); ok();
P.handle('file', () => new NxResponse('blocked', { status: 403 })); assert.deepStrictEqual(calls[1], ['intercept', 'file']); ok();
const bad = await new Promise((res) => { P.handle('vscode-webview', () => { throw new Error('boom'); }); P.cb({ url: 'x', method: 'GET', headers: {} }, res); });
assert.strictEqual(bad.statusCode, 500); ok();
P.unhandle('vscode-file'); P.unhandle('file'); assert.deepStrictEqual(calls.slice(-2), [['unregister', 'vscode-file'], ['unintercept', 'file']]); ok();
assert.strictEqual(P.isProtocolHandled('x'), true); ok();
console.log('compat OK (' + n + ' checks)');
