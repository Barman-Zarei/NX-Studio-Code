// Node loader hook: VS Code sources import './x.js' for files that are './x.ts' on disk. Maps .js -> .ts when .js does not exist.
export async function resolve(specifier, context, nextResolve) {
	try { return await nextResolve(specifier, context); }
	catch (e) {
		if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\/.*\.js$/.test(specifier)) { return nextResolve(specifier.replace(/\.js$/, '.ts'), context); }
		throw e;
	}
}
