const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const root=require('path').resolve(__dirname,'../com.texs.markerexport'),html=fs.readFileSync(root+'/index.html','utf8'),client=fs.readFileSync(root+'/js/client.js','utf8'),discovery=fs.readFileSync(root+'/js/encoder-discovery.js','utf8');
let checks=0;function check(value,message){assert(value,message);checks++}
check(html.includes('js/encoder-discovery.js'),'resolver script missing from actual HTML');
check(html.indexOf('js/encoder-discovery.js')<html.indexOf('js/client.js'),'resolver load order');
check(!/id="(?:useCustomPresets|videoSelect|audioSelect|presetBtn|audioBtn|videoPath|audioPath)"/.test(html),'removed preset selectors');
check(crypto.createHash('sha256').update(fs.readFileSync(root+'/host/export-markers.jsx')).digest('hex')==='d09964ed0bed9cfd88b26c38fcd9368c66a556d1f985043ec99e956b3186f495','core unchanged');
function run(options={}){
 let els={},calls=[],saved,encoders=options.encoders===undefined?[{major:26,path:'D:/Custom Encoder'}]:options.encoders,identity=options.identity||'26.5.2\tD:/Custom Premiere';
 for(const m of html.matchAll(/id="([^"]+)"/g))els[m[1]]={value:'',textContent:'',hidden:false,disabled:false,addEventListener(k,f){this[k]=f},setAttribute(){}};
 const ctx={window:{MarkerExportBuild:{version:'1.1.10',build:'B08'},__adobe_cep__:{},cep:{},cep_node:{require(name){assert.equal(name,'child_process');return {execFileSync(){if(options.failure)throw Error('denied');return JSON.stringify(encoders)}}}}},document:{getElementById:id=>{assert(els[id],'missing DOM '+id);return els[id]}},CSInterface:function(){this.evalScript=(s,f)=>{calls.push(s);if(s.startsWith('app.version'))f(identity);else if(s.includes('var v=File('))f(options.missingPreset?'MISSING':'OK');else if(s.startsWith('validateOutputFolder'))f('OK\tD:/Output');else if(options.result)f(options.result);else f('Queued 1 of 1 jobs.');};},localStorage:{getItem:()=>JSON.stringify({folder:'D:/Output',mode:'clipboundary',useCustomPresets:true,videoPreset:'C:/OLD.epr'}),setItem:(k,v)=>saved=JSON.parse(v)},setTimeout:()=>1,clearTimeout(){},Date,console};
 ctx.window.window=ctx.window;ctx.window.EncoderDiscovery=undefined;
 vm.runInNewContext(discovery,ctx);ctx.window.EncoderDiscovery=ctx.EncoderDiscovery;
 vm.runInNewContext(client,ctx);return {els,calls,options,set encoders(v){encoders=v},get saved(){return saved}};
}
let good=run();check(!good.els.exportBtn.disabled,'ready export');check(!good.els.previewBtn.disabled,'ready preview');
good.els.previewBtn.click();check(good.calls.at(-1).startsWith('previewClipExports('),'preview preserved');check(good.calls.at(-1).includes('D:/Custom Encoder'),'custom preset path');
good.els.exportBtn.click();check(good.calls.at(-1).startsWith('exportClipsAsFiles('),'clip enqueue preserved');check(good.calls.at(-1).includes('Waveform Audio'),'audio path');check(!good.calls.at(-1).includes('OLD.epr'),'legacy ignored');
good.els.mode.value='markers';good.els.mode.change();good.els.exportBtn.click();check(good.calls.at(-1).startsWith('exportMarkersAsClips('),'marker mode');check(good.saved.folder==='D:/Output','remember output');check(!('videoPreset' in good.saved),'no remembered custom preset');
good.encoders=[{major:25,path:'E:/Wrong Encoder'}];good.els.exportBtn.click();check(!good.calls.at(-1).startsWith('export'),'recheck blocks removed matching encoder');check(good.els.status.textContent.includes('AME 2026'),'specific missing dependency');
for(const options of [{encoders:[]},{encoders:[{major:25,path:'X:/25'}]},{missingPreset:true},{failure:true},{identity:'unknown\tX:/PR'}]){const bad=run(options);check(bad.els.exportBtn.disabled,'bad dependency export disabled');check(bad.els.previewBtn.disabled,'bad dependency preview disabled');check(bad.els.status.className==='err','visible error');check(!bad.calls.some(x=>x.startsWith('export')),'no enqueue');}
const multi=run({identity:'15.4\tE:/PR2021',encoders:[{major:26,path:'E:/AME26'},{major:15,path:'F:/AME2021'}]});multi.els.exportBtn.click();check(multi.calls.at(-1).includes('F:/AME2021'),'host15 selects15');check(!multi.calls.at(-1).includes('E:/AME26'),'never selects26 arbitrarily');
check(!client.includes('startBatch'),'queue-only');check(!fs.existsSync(root+'/presets'),'no bundled epr');
const mismatched=run({identity:'ERROR: Host version mismatch; expected 1.1.4, got 1.1.10'});check(mismatched.els.statusFull.textContent.includes('Host version mismatch'),'identity errors keep actual bridge root cause');check(!mismatched.els.statusFull.textContent.includes('无法确认当前 Premiere 版本与安装位置'),'no misleading generic identity error');check(mismatched.els.exportBtn.disabled,'mismatch blocks export');
console.log('RESULT checks='+checks+' failed=0');

const mixed=run({result:'Queued 1 export(s) in Adobe Media Encoder. Queue NOT started.\nQueued 1 of 2 jobs. Skipped 1. Failed 0.\nSKIP V1.2 clip=bad: source-null'});mixed.els.exportBtn.click();
check(mixed.els.status.textContent.includes('已入队 1')&&mixed.els.status.textContent.includes('跳过 1'),'counts visible in compact status');
check(mixed.els.statusDetails.open&&mixed.els.status.className==='warn','skip warning expands details');
check(mixed.els.statusFull.textContent.includes('V1.2'),'location retained in details');
console.log('B08 total frontend checks='+checks);

check(html.includes('id="buildVersion"')&&html.includes('1.1.10')&&!html.includes('B08'),'public version label without internal build');
check(!/\bB0[1-7]\b/.test(html),'no stale visible build metadata');
const bridge=fs.readFileSync(root+'/js/CSInterface.js','utf8');check(bridge.includes('build: "B08"')&&bridge.includes('hostBuild: "B08"'),'bridge host build pair B08');
console.log('B08 final frontend checks='+checks);

const nativeSummary=run({result:'Planned 142 jobs: 100 video, 42 audio.\nBuild: 1.1.10 B08\nTask groups: 144; planned=142; skipped=2.\nNative graphic jobs: 7.\nSingle-sided transitions retained: 9.\nSequence-source jobs: 2.\nSkipped 2.'});nativeSummary.els.previewBtn.click();
check(nativeSummary.els.statusFull.textContent.includes('原生图形任务：7'),'graphic summary Chinese');
check(nativeSummary.els.statusFull.textContent.includes('计划保留单边转场：9'),'transition summary Chinese');
check(nativeSummary.els.statusFull.textContent.includes('任务组：144；计划 142；跳过 2'),'group summary Chinese');
for(const [message,expected] of [['A two-sided or unclassified transition requires neighboring clip context; this job is skipped.','该双边或未分类转场'],['Cross-track matte dependency is not supported by target-only isolation; matte context must be preserved explicitly.','其他轨道的遮罩'],['Cannot prove transition sides: cut point does not match.','无法核实转场的单边方向'],['Clone does not preserve the native transition and its exact boundaries.','原生转场及精确边界校验']]){const f=run({result:'ERROR: '+message+'\nlocation=V1.1'});f.els.previewBtn.click();check(f.els.statusFull.textContent.includes(expected),'specific Chinese reason: '+expected);check(f.els.statusDetails.open&&f.els.status.className==='err','dependency error details visible');}
check(html.includes('父序列独立调整层可忽略，嵌套内部调整层保留'),'adjustment scope stated');
check(html.includes('1.1.10 图形／单边转场候选实现'),'candidate help identity');
console.log('B08 complete frontend checks='+checks+' failed=0');

check(good.els.buildVersion.textContent==='1.1.10','runtime main label excludes internal build');
check(html.includes('<p id="disabledClipNote" class="file-note">被禁用的片段不会被导出。</p>'),'disabled note retained in footer');
console.log('PUBLIC frontend checks='+checks+' failed=0');
