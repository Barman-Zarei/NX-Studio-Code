// NX Studio Code LEGACY (MIT): runtime capability flags for features that need a newer Electron than 22.
export const nxElectronMajor: number = parseInt((process.versions as Record<string, string | undefined>).electron ?? '0', 10);
/** Integrated browser needs WebContentsView / BaseWindow (Electron 30+). Disabled on older Electron. */
export const nxSupportsBrowserView: boolean = nxElectronMajor >= 30;
