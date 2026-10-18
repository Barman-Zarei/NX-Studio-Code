// @ts-nocheck
/*---------------------------------------------------------------------------------------------
 *  NX Studio Code LEGACY - compatibility polyfills (MIT).
 *  Electron 22 = Chromium 108 + Node 16.17. Upstream VS Code targets far newer runtimes.
 *  Only APIs that this source tree actually uses are covered; each is defined ONLY if missing.
 *  Written as plain JavaScript on purpose (also executed by nx/test-polyfills.mjs).
 *--------------------------------------------------------------------------------------------*/
(function (g) {
	function def(target, name, value) {
		if (target && !(name in target)) {
			Object.defineProperty(target, name, { value, writable: true, configurable: true });
		}
	}
	function timeoutError() {
		if (typeof g.DOMException === 'function') { return new g.DOMException('The operation timed out.', 'TimeoutError'); }
		const e = new Error('The operation timed out.'); e.name = 'TimeoutError'; return e;
	}

	// Array.prototype.toSorted / toReversed / toSpliced / with   (Chromium 110, Node 20)
	const A = g.Array.prototype;
	def(A, 'toSorted', function (compare) { return Array.prototype.slice.call(this).sort(compare); });
	def(A, 'toReversed', function () { return Array.prototype.slice.call(this).reverse(); });
	def(A, 'toSpliced', function (...args) { const c = Array.prototype.slice.call(this); c.splice(...args); return c; });
	def(A, 'with', function (index, value) {
		const len = this.length >>> 0; const i = Math.trunc(Number(index)) || 0; const k = i < 0 ? len + i : i;
		if (k < 0 || k >= len) { throw new RangeError('Invalid index : ' + index); }
		const c = Array.prototype.slice.call(this); c[k] = value; return c;
	});

	// Promise.withResolvers   (Chromium 119, Node 22)
	def(g.Promise, 'withResolvers', function () {
		let resolve, reject; const promise = new this((a, b) => { resolve = a; reject = b; });
		return { promise, resolve, reject };
	});

	// AbortSignal.any / AbortSignal.timeout   (Chromium 116 / Node 20; timeout: Node 17.3)
	if (g.AbortSignal && g.AbortController) {
		def(g.AbortSignal, 'any', function (signals) {
			const c = new g.AbortController();
			for (const s of signals) { if (s.aborted) { c.abort(s.reason); return c.signal; } }
			for (const s of signals) { s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
			return c.signal;
		});
		def(g.AbortSignal, 'timeout', function (ms) {
			const c = new g.AbortController(); const t = setTimeout(() => c.abort(timeoutError()), ms);
			if (t && typeof t.unref === 'function') { t.unref(); }
			return c.signal;
		});
	}

	// URL.canParse   (Chromium 120, Node 19.9)
	if (g.URL) {
		def(g.URL, 'canParse', function (url, base) { try { new g.URL(url, base); return true; } catch (e) { return false; } });
	}

	// Symbol.dispose / Symbol.asyncDispose   (Chromium 134, Node 20). Symbol.for => same symbol across realms.
	if (!g.Symbol.dispose) { Object.defineProperty(g.Symbol, 'dispose', { value: g.Symbol.for('Symbol.dispose') }); }
	if (!g.Symbol.asyncDispose) { Object.defineProperty(g.Symbol, 'asyncDispose', { value: g.Symbol.for('Symbol.asyncDispose') }); }

	// structuredClone   (Chromium 98 has it; Node 17+). Needed in Node 16 processes (main, extension host, pty host).
	def(g, 'structuredClone', function structuredClone(value) {
		const seen = new Map();
		const walk = (v) => {
			if (v === null || typeof v !== 'object') {
				if (typeof v === 'function' || typeof v === 'symbol') { throw new Error('structuredClone: value could not be cloned'); }
				return v;
			}
			if (seen.has(v)) { return seen.get(v); }
			let out;
			if (v instanceof Date) { return new Date(v.getTime()); }
			if (v instanceof RegExp) { return new RegExp(v.source, v.flags); }
			if (v instanceof ArrayBuffer) { return v.slice(0); }
			if (ArrayBuffer.isView(v)) { return new v.constructor(v.buffer.slice(0), v.byteOffset, v.length); }
			if (v instanceof Map) { out = new Map(); seen.set(v, out); v.forEach((val, key) => out.set(walk(key), walk(val))); return out; }
			if (v instanceof Set) { out = new Set(); seen.set(v, out); v.forEach((val) => out.add(walk(val))); return out; }
			if (v instanceof Error) { out = new v.constructor(v.message); out.name = v.name; out.stack = v.stack; return out; }
			out = Array.isArray(v) ? [] : {}; seen.set(v, out);
			for (const k of Object.keys(v)) { out[k] = walk(v[k]); }
			return out;
		};
		return walk(value);
	});
})(globalThis);

export { };
