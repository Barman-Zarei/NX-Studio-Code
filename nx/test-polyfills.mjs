// Runs src/nx-compat/polyfills.ts inside a vm context in which the "new" APIs have been REMOVED, then checks them.
// usage: node nx/test-polyfills.mjs   (any Node >= 16)
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const src = fs.readFileSync(new URL('../src/nx-compat/polyfills.ts', import.meta.url), 'utf8').replace(/^export \{ \};?\s*$/m, '');
const ctx = vm.createContext({ setTimeout, clearTimeout, URL, AbortController, AbortSignal: class AbortSignal extends EventTarget { }, console });
// Fresh realm built-ins, with the modern members deleted so that the polyfills must supply them.
vm.runInContext(`for (const n of ['toSorted','toReversed','toSpliced','with']) { delete Array.prototype[n]; }
  delete Promise.withResolvers; delete Symbol.dispose; delete Symbol.asyncDispose; delete globalThis.structuredClone;
  globalThis.URL = class U { constructor(u, b) { if (!/^[a-z]+:/.test(u) && !b) { throw new TypeError('bad'); } } };`, ctx);
vm.runInContext(src, ctx);
const t = (code) => vm.runInContext(code, ctx);
const j = (code) => JSON.stringify(vm.runInContext(code, ctx)); // cross-realm arrays: compare as JSON
assert.strictEqual(j('[3,1,2].toSorted((a,b)=>a-b)'), '[1,2,3]'); assert.strictEqual(j('(()=>{const a=[3,1];a.toSorted();return a})()'), '[3,1]');
assert.strictEqual(j('[1,2,3].toReversed()'), '[3,2,1]');
assert.strictEqual(j('[1,2,3].toSpliced(1,1,9,9)'), '[1,9,9,3]');
assert.strictEqual(j('[1,2,3].with(-1, 7)'), '[1,2,7]'); assert.throws(() => t('[1].with(5, 0)'), /RangeError|Invalid/);
assert.strictEqual(t('typeof Symbol.dispose + typeof Symbol.asyncDispose'), 'symbolsymbol');
assert.strictEqual(t('URL.canParse("https://a.b") + "," + URL.canParse("nope")'), 'true,false');
const clone = j('(()=>{const o={a:[1,{b:2}],m:new Map([[1,new Set([2])]]),d:new Date(5)};o.self=o;const c=structuredClone(o);return [c!==o,c.self===c,c.a[1].b,c.m.get(1).has(2),c.d.getTime()]})()');
assert.strictEqual(clone, '[true,true,2,true,5]');
const r = t('(async()=>{const {promise,resolve}=Promise.withResolvers();resolve(4);return await promise})()'); assert.strictEqual(await r, 4);
const any = j('(()=>{const a=new AbortController(),b=new AbortController();const s=AbortSignal.any([a.signal,b.signal]);b.abort("x");return [s.aborted,s.reason]})()');
assert.strictEqual(any, '[true,"x"]');
const to = t('AbortSignal.timeout(5)'); await new Promise((r2) => setTimeout(r2, 40)); assert.strictEqual(to.aborted, true); assert.strictEqual(to.reason.name, 'TimeoutError');
console.log('polyfills OK (13 checks)');
