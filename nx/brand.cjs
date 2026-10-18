#!/usr/bin/env node
'use strict';
/* NX Studio Code branding: idempotently rewrites product.json of an upstream Code-OSS tree.
   usage: node nx/brand.cjs [repoRoot] [main|legacy]                                            */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || '.');
const line = process.argv[3] || 'main';
const file = path.join(root, 'product.json');
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
// Deterministic GUIDs so re-running never changes installer identities.
const guid = (k) => { const h = crypto.createHash('sha1').update('nx-studio-code/' + line + '/' + k).digest('hex');
  return '{{' + [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-').toUpperCase() + '}'; };
const REPO = 'https://github.com/Barman-Zarei/NX-Studio-Code';

Object.assign(p, {
  nameShort: 'NX Studio Code', nameLong: 'NX Studio Code', applicationName: 'nx-studio-code',
  dataFolderName: '.nx-studio-code', serverApplicationName: 'nx-studio-code-server', serverDataFolderName: '.nx-studio-code-server',
  win32DirName: 'NX Studio Code', win32NameVersion: 'NX Studio Code', win32RegValueName: 'NXStudioCode', win32ShellNameShort: 'NX Studio &Code',
  win32AppUserModelId: 'Barman.NXStudioCode', win32MutexName: 'nxstudiocode',
  darwinBundleIdentifier: 'com.barman.nxstudiocode', linuxIconName: 'nx-studio-code', urlProtocol: 'nx-studio-code',
  reportIssueUrl: REPO + '/issues/new', licenseUrl: REPO + '/blob/' + (line === 'legacy' ? 'LEGACY' : 'main') + '/LICENSE.txt',
  nxVersion: '1.0.0', nxAuthor: 'Barman', nxLine: line,
  // Open VSX instead of the Microsoft Marketplace (whose terms forbid use by other products).
  extensionsGallery: { serviceUrl: 'https://open-vsx.org/vscode/gallery', itemUrl: 'https://open-vsx.org/vscode/item',
    resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}' },
  // Defaults only; the user can change everything.
  configurationDefaults: Object.assign({}, p.configurationDefaults, { 'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'workbench.enableExperiments': false },
    line === 'legacy' ? { 'terminal.integrated.gpuAcceleration': 'off', 'editor.minimap.enabled': false } : {}),
});
for (const k of ['win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId', 'win32AppId', 'win32UserAppId']) {
  if (k in p) { p[k] = guid(k); }
}
if ('linuxDesktopName' in p) { p.linuxDesktopName = 'nx-studio-code.desktop'; }
if ('sharedDataFolderName' in p) { p.sharedDataFolderName = '.nx-studio-code-shared'; }
if ('tunnelApplicationName' in p) { p.tunnelApplicationName = 'nx-studio-code-tunnel'; }
// Tunnel mutexes are required by the Windows installer definition: rebrand, never delete.
if ('win32TunnelMutex' in p) { p.win32TunnelMutex = 'nxstudiocode-tunnel'; }
if ('win32TunnelServiceMutex' in p) { p.win32TunnelServiceMutex = 'nxstudiocode-tunnelservice'; }
// Only `builtInExtensions` is removed (the build code reads it with `|| []`): it makes the build download Microsoft
// Marketplace binaries. Other upstream keys are kept on purpose: parts of the workbench read them without null checks.
delete p.builtInExtensions;
fs.writeFileSync(file, JSON.stringify(p, null, '\t') + '\n');
console.log('branded ' + file + ' (' + line + ')');
