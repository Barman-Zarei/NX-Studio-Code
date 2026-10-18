/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { enableNodeCompileCache } from './vs/base/node/nodeCompileCache.js';

enableNodeCompileCache('main');

// NX LEGACY: Electron 22 has no ES-module main process, so these entry files are bundled as CommonJS,
// where top-level await is not allowed. Same sequence, wrapped in an async function.
import('./mainImpl.js').catch(err => { console.error(err); process.exit(1); });
