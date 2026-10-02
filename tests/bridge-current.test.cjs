const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../com.texs.markerexport');
const bridgeCode=fs.readFileSync(root+'/js/CSInterface.js','utf8'),hostCode=fs.readFileSync(root+'/host/export-markers.jsx','utf8');
function bridge(options={}){
 const events=[],loads=[];
 const host=vm.createContext({encodeURIComponent,app:{version:'15.4.1',project:{activeSequence:null}},Folder:{startup:{fsName:'D:/Adobe/PR'}},File:function(p){this.fsName=p;this.exists=true;}});
 const endpoints={previewClipExports:'preview',diagnoseExportBoundaries:'diagnose',validateOutputFolder:'folder',exportClipsAsFiles:'clipqueue',exportMarkersAsClips:'markerqueue'};
 host.$={global:{},evalFile(p){loads.push(p);events.push('reload');if(options.missing)throw Error('missing host');vm.runInContext(hostCode,host);if(options.version)host.MarkerExportHostVersion=options.version;if(options.build)host.MarkerExportHostBuild=options.build;for(const [name,label] of Object.entries(endpoints))host[name]=()=>{events.push(label);return 'OK '+label;};}};
 const window={__adobe_cep__:{getSystemPath:()=>options.root||'C:/Current Extension',evalScript(code,callback){callback(vm.runInContext(code,host));}}};
 const ctx=vm.createContext({window,Date,Math,JSON,encodeURIComponent,decodeURIComponent});vm.runInContext(bridgeCode,ctx);const cs=new ctx.CSInterface();
 return {events,loads,window,call(script){let result;cs.evalScript(script,r=>result=r);return result;}};
}
for(const [script,result] of [['previewClipExports("all")','preview'],['diagnoseExportBoundaries("all")','diagnose'],['validateOutputFolder("D:/Output")','folder'],['exportClipsAsFiles()','clipqueue'],['exportMarkersAsClips()','markerqueue'],['app.version + "\\t" + Folder.startup.fsName','15.4.1\tD:/Adobe/PR'],['(function(){return "OK";})()','OK']]){
 test('real bridge + real host permit '+result,()=>{const b=bridge();assert.equal(b.call(script),result==='OK' || result.startsWith('15.')?result:'OK '+result);assert.equal(b.loads.length,1);assert.equal(b.loads[0],'C:/Current Extension/host/export-markers.jsx');});
}
test('B08 rejects an older host version before dispatch',()=>{const b=bridge({version:'1.1.4'});assert.match(b.call('exportClipsAsFiles()'),/^ERROR:.*version mismatch/i);assert.deepEqual(b.events,['reload']);});
test('same version with stale B02 build is rejected before dispatch',()=>{const b=bridge({build:'B02'});assert.match(b.call('exportClipsAsFiles()'),/^ERROR:.*build mismatch/i);assert.deepEqual(b.events,['reload']);});
test('missing installed host never dispatches stale entrypoints',()=>{const b=bridge({missing:true});assert.match(b.call('previewClipExports("all")'),/^ERROR:/);assert.deepEqual(b.events,['reload']);});
test('current log identifies version and build without old ME117 or expected1.1.4',()=>{const b=bridge();b.call('diagnoseExportBoundaries("all")');const log=b.window.MarkerExportLog.text();assert.match(log,/1\.1\.10/);assert.match(log,/B08/);assert.doesNotMatch(log,/ME117|frontendVersion=1\.1\.7|核心 1\.1\.4/);});
test('literal quoted extension paths survive serialization',()=>{const b=bridge({root:'file:///C:/扩展%20Root/quote"/x\u2028'});assert.equal(b.call('previewClipExports("all")'),'OK preview');assert.equal(b.loads[0],'C:/扩展 Root/quote"/x\u2028/host/export-markers.jsx');});
