// @ts-nocheck
// NX Studio Code LEGACY: side-effect import for the Electron main process (imported first by src/mainImpl.ts).
import * as electron from 'electron';
import { installElectronShims } from './electron-shims.js';
installElectronShims(electron);
