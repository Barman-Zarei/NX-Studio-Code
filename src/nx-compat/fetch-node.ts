// NX Studio Code LEGACY (MIT). Node 16.17 (Electron 22) has no global fetch/Request/Response/Headers; VS Code's main
// process and extension host use them. Minimal implementation on node:http(s)/fs: file:, http:, https:, redirects,
// Range on file:, gzip/deflate/br, AbortSignal. Not implemented: streaming request bodies, cookies, CORS, system proxy.
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

type HeadersInit = Record<string, string | string[]> | Iterable<[string, string]> | NxHeaders | undefined;

export class NxHeaders {
	private readonly m = new Map<string, string>();
	constructor(init?: HeadersInit) {
		if (!init) { return; }
		if (init instanceof NxHeaders) { init.forEach((v, k) => this.append(k, v)); return; }
		if (typeof (init as Iterable<[string, string]>)[Symbol.iterator] === 'function') { for (const [k, v] of init as Iterable<[string, string]>) { this.append(k, v); } return; }
		for (const [k, v] of Object.entries(init as Record<string, string | string[]>)) { this.append(k, Array.isArray(v) ? v.join(', ') : String(v)); }
	}
	append(k: string, v: string) { const key = k.toLowerCase(); const o = this.m.get(key); this.m.set(key, o === undefined ? String(v) : o + ', ' + v); }
	set(k: string, v: string) { this.m.set(k.toLowerCase(), String(v)); }
	get(k: string) { const v = this.m.get(k.toLowerCase()); return v === undefined ? null : v; }
	has(k: string) { return this.m.has(k.toLowerCase()); }
	delete(k: string) { this.m.delete(k.toLowerCase()); }
	forEach(cb: (v: string, k: string, h: NxHeaders) => void) { this.m.forEach((v, k) => cb(v, k, this)); }
	entries() { return this.m.entries(); }
	keys() { return this.m.keys(); }
	values() { return this.m.values(); }
	[Symbol.iterator]() { return this.m.entries(); }
	toObject(): Record<string, string> { return Object.fromEntries(this.m); }
}

type Body = string | Uint8Array | ArrayBuffer | Readable | null | undefined;
function toBuffer(b: Body): Buffer | null {
	if (b === null || b === undefined) { return null; }
	if (typeof b === 'string') { return Buffer.from(b); }
	if (b instanceof ArrayBuffer) { return Buffer.from(b); }
	if (b instanceof Uint8Array) { return Buffer.from(b.buffer, b.byteOffset, b.byteLength); }
	return null;
}

export class NxResponse {
	readonly status: number; readonly statusText: string; readonly headers: NxHeaders; url = ''; readonly redirected = false; readonly type = 'basic';
	/** Node stream of the body (not a WHATWG ReadableStream). */
	readonly body: Readable | null;
	private used = false;
	constructor(body?: Body, init?: { status?: number; statusText?: string; headers?: HeadersInit }) {
		this.status = init?.status ?? 200; this.statusText = init?.statusText ?? ''; this.headers = new NxHeaders(init?.headers);
		const buf = toBuffer(body);
		this.body = body instanceof Readable ? body : buf ? Readable.from([buf]) : null;
	}
	get ok() { return this.status >= 200 && this.status < 300; }
	private async read(): Promise<Buffer> {
		if (this.used) { throw new TypeError('Body is unusable: Body has already been read'); }
		this.used = true; const chunks: Buffer[] = [];
		if (this.body) { for await (const c of this.body) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } }
		return Buffer.concat(chunks);
	}
	async arrayBuffer() { const b = await this.read(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
	async text() { return (await this.read()).toString('utf8'); }
	async json() { return JSON.parse(await this.text()); }
	static json(data: unknown, init?: { status?: number; headers?: HeadersInit }) { const h = new NxHeaders(init?.headers); if (!h.has('content-type')) { h.set('content-type', 'application/json'); } return new NxResponse(JSON.stringify(data), { status: init?.status, headers: h }); }
}

export class NxRequest {
	readonly url: string; readonly method: string; readonly headers: NxHeaders; readonly body: Body; readonly signal: AbortSignal | undefined; readonly redirect: string;
	constructor(input: string | URL | NxRequest, init?: { method?: string; headers?: HeadersInit; body?: Body; signal?: AbortSignal; redirect?: string }) {
		const base = input instanceof NxRequest ? input : undefined;
		this.url = base ? base.url : String(input); this.method = (init?.method ?? base?.method ?? 'GET').toUpperCase();
		this.headers = new NxHeaders(init?.headers ?? base?.headers); this.body = init?.body ?? base?.body; this.signal = init?.signal ?? base?.signal; this.redirect = init?.redirect ?? base?.redirect ?? 'follow';
	}
}

function abortError(signal: AbortSignal) { const r = (signal as AbortSignal & { reason?: unknown }).reason; if (r) { return r; } const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; }

function fileResponse(url: URL, req: NxRequest): NxResponse {
	const p = fileURLToPath(url);
	let st: fs.Stats; try { st = fs.statSync(p); } catch { return new NxResponse('Not found', { status: 404 }); }
	if (!st.isFile()) { return new NxResponse('Not found', { status: 404 }); }
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
	const headers = new NxHeaders({ 'accept-ranges': 'bytes' });
	if (range && (range[1] || range[2])) {
		let start = range[1] ? parseInt(range[1], 10) : Math.max(0, st.size - parseInt(range[2], 10));
		let end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
		if (start > end || start >= st.size) { headers.set('content-range', 'bytes */' + st.size); return new NxResponse(null, { status: 416, headers }); }
		headers.set('content-range', `bytes ${start}-${end}/${st.size}`); headers.set('content-length', String(end - start + 1));
		return new NxResponse(fs.createReadStream(p, { start, end }), { status: 206, headers });
	}
	headers.set('content-length', String(st.size));
	return new NxResponse(req.method === 'HEAD' ? null : fs.createReadStream(p), { status: 200, headers });
}

function httpResponse(url: URL, req: NxRequest, hops: number): Promise<NxResponse> {
	return new Promise((resolve, reject) => {
		const lib = url.protocol === 'https:' ? https : http;
		const body = toBuffer(req.body);
		const headers = req.headers.toObject(); if (!('accept-encoding' in headers)) { headers['accept-encoding'] = 'gzip, deflate, br'; }
		if (body && !('content-length' in headers)) { headers['content-length'] = String(body.length); }
		const r = lib.request(url, { method: req.method, headers }, (res) => {
			const status = res.statusCode ?? 0; const loc = res.headers['location'];
			if (loc && [301, 302, 303, 307, 308].includes(status) && req.redirect !== 'manual') {
				res.resume();
				if (req.redirect === 'error' || hops >= 20) { return reject(new TypeError('fetch failed: redirect')); }
				const next = new URL(loc, url); const keep = status === 307 || status === 308;
				return resolve(httpResponse(next, new NxRequest(next.toString(), { method: keep ? req.method : 'GET', headers: req.headers, body: keep ? req.body : undefined, signal: req.signal, redirect: req.redirect }), hops + 1));
			}
			let stream: Readable = res; const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
			if (enc === 'gzip') { stream = res.pipe(zlib.createGunzip()); } else if (enc === 'deflate') { stream = res.pipe(zlib.createInflate()); } else if (enc === 'br') { stream = res.pipe(zlib.createBrotliDecompress()); }
			const h = new NxHeaders(res.headers as Record<string, string | string[]>); if (enc) { h.delete('content-encoding'); h.delete('content-length'); }
			const out = new NxResponse(stream, { status, statusText: res.statusMessage, headers: h }); out.url = url.toString(); resolve(out);
		});
		r.on('error', (e) => reject(Object.assign(new TypeError('fetch failed'), { cause: e })));
		const sig = req.signal; if (sig) { if (sig.aborted) { r.destroy(); return reject(abortError(sig)); } sig.addEventListener('abort', () => { r.destroy(); reject(abortError(sig)); }, { once: true }); }
		if (body) { r.write(body); } r.end();
	});
}

export async function nxFetch(input: string | URL | NxRequest, init?: ConstructorParameters<typeof NxRequest>[1]): Promise<NxResponse> {
	const req = new NxRequest(input, init); const url = new URL(req.url);
	if (req.signal?.aborted) { throw abortError(req.signal); }
	let res: NxResponse;
	if (url.protocol === 'file:') { res = fileResponse(url, req); }
	else if (url.protocol === 'http:' || url.protocol === 'https:') { res = await httpResponse(url, req, 0); }
	else if (url.protocol === 'data:') { const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(req.url); if (!m) { throw new TypeError('invalid data: URL'); } res = new NxResponse(m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])), { headers: { 'content-type': m[1] || 'text/plain' } }); }
	else { throw new TypeError('fetch failed: unsupported protocol ' + url.protocol); }
	if (!res.url) { res.url = req.url; }
	return res;
}

/** Installs Headers/Request/Response/fetch on `g` for whatever is missing (or everything when `force`). */
export function installFetch(g: Record<string, unknown>, force = false): void {
	const def = (k: string, v: unknown) => { if (force || typeof g[k] === 'undefined') { Object.defineProperty(g, k, { value: v, writable: true, configurable: true }); } };
	def('Headers', NxHeaders); def('Request', NxRequest); def('Response', NxResponse); def('fetch', nxFetch);
}

installFetch(globalThis as unknown as Record<string, unknown>);
