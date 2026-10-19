// Static audit: which Electron APIs used by src/ do not exist in Electron 22?
// usage: TYPESCRIPT=<typescript pkg> ELECTRON_DTS=<electron@22.3.27 electron.d.ts> node --max-old-space-size=2400 nx/audit-electron-api.cjs
const ts=require(process.env.TYPESCRIPT || 'typescript'); const fs=require('fs'), path=require('path'), cp=require('child_process');
const root=path.resolve(__dirname,'..');
const files=cp.execSync(`grep -rlE --include=*.ts "from 'electron'|from \\"electron\\"|require\\('electron'\\)" src | grep -v /test/`,{cwd:root,encoding:'utf8'}).trim().split('\n').map(f=>path.join(root,f));
const dts=fs.readFileSync(process.env.ELECTRON_DTS,'utf8');
const names=new Set([...dts.matchAll(/^\s*(?:class|interface|namespace|const|type)\s+([A-Za-z_]\w*)/gm)].map(m=>m[1]));
const opts={noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,allowImportingTsExtensions:true,experimentalDecorators:true,strict:false,noImplicitAny:false,baseUrl:'/',paths:{electron:[process.env.ELECTRON_DTS]},types:[],lib:['lib.es2022.d.ts','lib.dom.d.ts'],resolveJsonModule:true};
const prog=ts.createProgram(files,opts); const out=new Map();
for(const d of ts.getPreEmitDiagnostics(prog)){
  if(!d.file||!d.file.fileName.startsWith(root+'/src')) continue;
  const msg=ts.flattenDiagnosticMessageText(d.messageText,'\n').split('\n')[0];
  let hit=false, what='';
  let m=/Property '([^']+)' does not exist on type '(?:typeof )?([A-Za-z_]\w*)/.exec(msg); if(m&&names.has(m[2])){hit=true;what=m[2]+'.'+m[1];}
  m=/has no exported member '([^']+)'/.exec(msg); if(!hit&&m&&/electron/.test(msg)){hit=true;what='export '+m[1];}
  m=/Object literal may only specify known properties, and '([^']+)' does not exist in type '([A-Za-z_]\w*)/.exec(msg); if(!hit&&m&&names.has(m[2])){hit=true;what=m[2]+' option '+m[1];}
  if(!hit) continue;
  const {line}=d.file.getLineAndCharacterOfPosition(d.start); const rel=path.relative(root,d.file.fileName)+':'+(line+1);
  if(!out.has(what)) out.set(what,[]); out.get(what).push(rel);
}
console.log('files analysed:',files.length,'| distinct Electron>22 API gaps:',out.size);
for(const [k,v] of [...out].sort((a,b)=>b[1].length-a[1].length)) console.log(String(v.length).padStart(3),k.padEnd(46),v[0]);
