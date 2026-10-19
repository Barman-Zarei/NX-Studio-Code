// @ts-nocheck
// NX Studio Code LEGACY (MIT). Electron 22 lacks protocol.handle/unhandle/isProtocolHandled (added in 25) and net.fetch (25).
// VS Code 1.143 serves its whole workbench through protocol.handle('vscode-file'). These shims map them onto the
// Electron-22 stream-protocol API using the Request/Response implementation of ./fetch-node.ts.
import { Readable } from 'node:stream';
import { NxRequest, nxFetch } from './fetch-node.js';

// Built-in schemes can only be overridden by interception; custom schemes are registered.
const INTERCEPT = new Set(['file', 'http', 'https', 'ftp']);

function uploadBody(upload) {
	if (!upload || !upload.length) { return undefined; }
	const parts = upload.filter((u) => u && u.bytes).map((u) => u.bytes);
	return parts.length ? Buffer.concat(parts) : undefined;
}

function respond(res, callback) {
	const headers = {};
	res.headers.forEach((v, k) => { headers[k] = v; });
	callback({ statusCode: res.status, headers, data: res.body || Readable.from([]) });
}

/** Adds handle/unhandle/isProtocolHandled to a Protocol (prototype or instance) that lacks them. */
export function patchProtocol(P) {
	if (!P || typeof P.handle === 'function') { return false; }
	P.handle = function (scheme, handler) {
		const listener = async (req, callback) => {
			try {
				respond(await handler(new NxRequest(req.url, { method: req.method, headers: req.headers, body: uploadBody(req.uploadData) })), callback);
			} catch (e) {
				callback({ statusCode: 500, headers: { 'content-type': 'text/plain' }, data: Readable.from([String((e && e.message) || e)]) });
			}
		};
		const ok = INTERCEPT.has(scheme) ? this.interceptStreamProtocol(scheme, listener) : this.registerStreamProtocol(scheme, listener);
		if (ok === false) { throw new Error(`protocol.handle: scheme '${scheme}' could not be handled (already handled or not registered as privileged)`); }
	};
	P.unhandle = function (scheme) { return INTERCEPT.has(scheme) ? this.uninterceptProtocol(scheme) : this.unregisterProtocol(scheme); };
	P.isProtocolHandled = function (scheme) { return INTERCEPT.has(scheme) ? this.isProtocolIntercepted(scheme) : this.isProtocolRegistered(scheme); };
	return true;
}

function patchFrame(frame) {
	const P = frame && Object.getPrototypeOf(frame);
	if (!P || P.__nxFramePatched) { return; }
	P.__nxFramePatched = true;
	// Electron < 29 has no WebFrameMain.isDestroyed(); a destroyed frame throws on property access.
	if (typeof P.isDestroyed !== 'function') { P.isDestroyed = function () { try { void this.processId; return false; } catch (e) { return true; } }; }
	if (typeof P.collectJavaScriptCallStack !== 'function') { P.collectJavaScriptCallStack = async function () { return undefined; }; }
}

export function installElectronShims(electron) {
	const { app, session } = electron;
	// Small API gaps found by the static audit against the Electron 22 typings (see docs/LEGACY.md).
	if (typeof app.resolveProxy !== 'function') { app.resolveProxy = (url) => session.defaultSession.resolveProxy(url); }
	if (typeof app.setProxy !== 'function') { app.setProxy = (config) => session.defaultSession.setProxy(config); }
	if (typeof app.setDesktopName !== 'function') { app.setDesktopName = () => { }; }
	if (electron.contentTracing && typeof electron.contentTracing.enableHeapProfiling !== 'function') { electron.contentTracing.enableHeapProfiling = async () => undefined; }
	const BW = electron.BrowserWindow && electron.BrowserWindow.prototype;
	if (BW && typeof BW.setAccentColor !== 'function') { BW.setAccentColor = function () { }; }
	app.on('web-contents-created', (_e, wc) => { try { patchFrame(wc.mainFrame); } catch (e) { /* no frame yet */ } });
	app.whenReady().then(() => { // powerMonitor can only be touched after ready
		const pm = electron.powerMonitor;
		if (pm && typeof pm.getCurrentThermalState !== 'function') { pm.getCurrentThermalState = () => 'unknown'; }
	});
	if (electron.net && typeof electron.net.fetch !== 'function') { electron.net.fetch = nxFetch; }
	const tryPatch = (s) => { try { patchProtocol(Object.getPrototypeOf(s.protocol)); } catch (e) { /* session not ready yet */ } };
	app.on('session-created', tryPatch);
	try { if (session.defaultSession) { tryPatch(session.defaultSession); } } catch (e) { /* before ready */ }
	app.whenReady().then(() => tryPatch(session.defaultSession));
	// module-level `protocol` forwards to the default session
	const mod = electron.protocol;
	if (mod && typeof mod.handle !== 'function') {
		for (const m of ['handle', 'unhandle', 'isProtocolHandled']) {
			mod[m] = (...a) => { tryPatch(session.defaultSession); return session.defaultSession.protocol[m](...a); };
		}
	}
}
