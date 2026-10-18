/*---------------------------------------------------------------------------------------------
 *  NX Studio Code LEGACY (MIT). Electron 22 (Chromium 108 / Node 16.17) cannot load an ES-module main process
 *  (Electron gained ESM support in 28) and is older than the browser targets upstream compiles for.
 *  Node-side bundles are therefore emitted as CommonJS; renderer bundles are lowered to Chromium 108.
 *--------------------------------------------------------------------------------------------*/

import type * as esbuild from 'esbuild';

/** Bootstrap entries (platform node) are always node-side. */
export function isNxNodeEntry(entry: string): boolean {
	return /(^|\/)node\//.test(entry) || /electron-(main|utility)\//.test(entry) || /^vs\/code\/node\//.test(entry);
}

const IMPORT_META_SHIM = 'const __nx_import_meta_url = require("url").pathToFileURL(__filename).href;';

export function applyNxLegacy(options: esbuild.BuildOptions, kind: 'node' | 'browser'): esbuild.BuildOptions {
	if (kind === 'browser') {
		// Lowers syntax, and CSS where it can be done statically, for Chromium 108.
		return { ...options, target: ['chrome108'] };
	}
	const banner = options.banner ?? {};
	return {
		...options,
		format: 'cjs',
		platform: 'node',
		target: ['node16.17'],
		// import('x') -> Promise.resolve().then(() => require('x')): no ESM loader needed in Electron 22
		supported: { ...options.supported, 'dynamic-import': false },
		define: {
			...options.define,
			'import.meta.url': '__nx_import_meta_url',
			'import.meta.dirname': '__dirname',
			'import.meta.filename': '__filename',
		},
		banner: { ...banner, js: `${banner.js ?? ''}\n${IMPORT_META_SHIM}` },
	};
}
